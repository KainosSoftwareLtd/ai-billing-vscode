import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { Config } from './config';

const KEY = 'aiBilling.usageRecords';
const MAX_RECORDS = 2000;

export interface UsageRecord {
  // Timestamp when the request was made
  ts: number;
  // vendor: identifies the AI provider (claude, gpt, etc.)
  provider: 'claude' | 'copilot' | 'ollama' | 'unknown';
  // family: the model identifier/name (e.g. 'Claude Haiku 4.5', 'GPT-4o')
  model: string;
  input: number;
  output: number;
  cacheCreate: number;
  cacheRead: number;
  // detail: credit cost information from chatSessions or calculated from tokens
  requestUnits: number;
  costUsd: number;
  costForecastUsd?: number;
  // metadata.name: identifies routing - true=auto, false/undefined=explicit
  isAutoModel?: boolean;
  // detail: applied discount percentage for this record
  appliedDiscountPercent?: number;
}

export interface RawUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}
export interface ModelMetrics {
  model: string;
  baseModel: string;
  routing: 'auto' | 'explicit';
  provider: UsageRecord['provider'];
  calls: number;
  input: number;
  output: number;
  requestUnits: number;
  cost: number;
  costForecast: number;
}

export interface ModelComparisonMetrics {
  model: string;
  calls: number;
  autoCredits: number;
  explicitCredits: number;
  totalCredits: number;
  cost: number;
  costForecast: number;
  discountApplied?: number;
}

export interface VendorMetrics {
  // vendor: identifies the AI provider (claude, copilot, etc.)
  vendor: 'claude' | 'copilot' | 'ollama' | 'unknown';
  calls: number;
  autoCredits: number;
  explicitCredits: number;
  totalCredits: number;
  cost: number;
  costForecast: number;
  // detail: discount information if configured
  discountApplied?: number;
}

export interface RecordUsageArgs {
  model: string;
  usage?: RawUsage;
  explicitCostUsd?: number;
  provider?: UsageRecord['provider'];
  requestUnits?: number;
  ts?: number;
  isAutoModel?: boolean;
}

// Pricing loaded from configuration (per million tokens)
interface ModelPricing {
  in: number;
  out: number;
  cachedIn?: number;
  cacheWrite?: number;
  requestUnits?: number;
}

interface PricingCatalog {
  models: Record<string, ModelPricing>;
  fallback: ModelPricing;
}

const HARD_DEFAULT_FALLBACK: ModelPricing = { in: 3.0, out: 15.0, cachedIn: 0.3, cacheWrite: 3.75 };
let pricingCatalogCache: PricingCatalog | undefined;

interface BillableUsage {
  input: number;
  output: number;
  cacheCreate: number;
  cacheRead: number;
}

const FORECAST_LOOKBACK_DAYS = 14;
const FORECAST_MIN_POINTS = 3;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function dayStart(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function regression(values: number[]): { slope: number; intercept: number } {
  const n = values.length;
  if (n <= 1) {
    return { slope: 0, intercept: values[0] ?? 0 };
  }

  const meanX = (n - 1) / 2;
  const meanY = values.reduce((sum, v) => sum + v, 0) / n;

  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i++) {
    const dx = i - meanX;
    numerator += dx * (values[i] - meanY);
    denominator += dx * dx;
  }

  const slope = denominator > 0 ? numerator / denominator : 0;
  const intercept = meanY - slope * meanX;
  return { slope, intercept };
}

function dailyCostsFromRecords(recs: UsageRecord[], days = FORECAST_LOOKBACK_DAYS): number[] {
  if (!recs.length) {
    return [];
  }

  const endDayTs = dayStart(Math.max(...recs.map((r) => r.ts)));
  const startDayTs = endDayTs - (days - 1) * 24 * 60 * 60 * 1000;
  const costs = Array.from({ length: days }, () => 0);

  for (const r of recs) {
    const dayTs = dayStart(r.ts);
    if (dayTs < startDayTs || dayTs > endDayTs) {
      continue;
    }
    const index = Math.floor((dayTs - startDayTs) / (24 * 60 * 60 * 1000));
    if (index >= 0 && index < costs.length) {
      costs[index] += actualCostForRecord(r);
    }
  }

  return costs;
}

function forecastMultiplierForRecords(recs: UsageRecord[]): number {
  const dailyCosts = dailyCostsFromRecords(recs);
  if (dailyCosts.length < FORECAST_MIN_POINTS) {
    return 1;
  }

  const nonZeroDays = dailyCosts.filter((v) => v > 0).length;
  if (nonZeroDays < 2) {
    return 1;
  }

  const { slope, intercept } = regression(dailyCosts);
  const n = dailyCosts.length;
  const predictedNext = Math.max(0, intercept + slope * n);
  const baseline = Math.max(0, dailyCosts[n - 1]);
  const fallbackBaseline = dailyCosts.reduce((sum, v) => sum + v, 0) / n;
  const denom = baseline > 0 ? baseline : fallbackBaseline;

  if (denom <= 0) {
    return 1;
  }

  const rawMultiplier = predictedNext / denom;
  return clamp(rawMultiplier, 0.5, 2.0);
}

function trendSeries(values: number[]): number[] {
  if (values.length < FORECAST_MIN_POINTS) {
    return [...values];
  }

  const { slope, intercept } = regression(values);
  return values.map((_, i) => Math.max(0, intercept + slope * i));
}

function stripModelPrefix(model: string): string {
  return model.replace(/^copilot:/i, '').trim();
}

function removeTrailingModelDate(value: string): string {
  // Handles suffixes like -20251001, -2026-03-05, .2026.03.05, or " 2026-03-05"
  return value
    .replace(/[\s\-._]?(?:\(?20\d{2}[-._]?\d{2}[-._]?\d{2}\)?)$/i, '')
    .trim();
}

function prettifyModelName(value: string): string {
  const cleaned = removeTrailingModelDate(stripModelPrefix(value));
  if (!cleaned) {
    return value;
  }

  // Keep user-friendly names as-is (contains spaces and uppercase words).
  if (/\s/.test(cleaned) && /[A-Z]/.test(cleaned)) {
    return cleaned;
  }

  let normalized = cleaned
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  // Normalize common dotted versions from slug-style ids.
  normalized = normalized
    .replace(/(gpt-\d+)-(\d+)(?=-|$)/, '$1.$2')
    .replace(/(claude-(?:haiku|sonnet|opus)-\d+)-(\d+)(?=-|$)/, '$1.$2');

  if (normalized.startsWith('gpt-')) {
    return normalized.replace(/^gpt-/, 'GPT-').replace(/-mini/g, ' Mini').replace(/-nano/g, ' Nano').replace(/-long/g, ' Long').replace(/-codex/g, '-Codex');
  }

  if (normalized.startsWith('claude-')) {
    return normalized
      .replace(/^claude-/, 'Claude ')
      .replace(/-/g, ' ')
      .replace(/\b(sonnet|haiku|opus|fable)\b/g, (m) => m.charAt(0).toUpperCase() + m.slice(1));
  }

  if (normalized.startsWith('gemini-')) {
    return normalized.replace(/^gemini-/, 'Gemini ').replace(/-/g, ' ').replace(/\b(pro|flash|long)\b/g, (m) => m.charAt(0).toUpperCase() + m.slice(1));
  }

  return cleaned;
}

function isValidModelPricing(value: unknown): value is ModelPricing {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const v = value as Record<string, unknown>;
  return typeof v.in === 'number' && Number.isFinite(v.in) && v.in >= 0
    && typeof v.out === 'number' && Number.isFinite(v.out) && v.out >= 0;
}

function loadPricingCatalog(): PricingCatalog {
  if (pricingCatalogCache) {
    return pricingCatalogCache;
  }

  const pricingPath = path.join(__dirname, 'pricing.json');
  try {
    const rawText = fs.readFileSync(pricingPath, 'utf8');
    const parsed = JSON.parse(rawText) as { models?: Record<string, unknown>; fallback?: unknown };

    const models: Record<string, ModelPricing> = {};
    for (const [key, value] of Object.entries(parsed.models ?? {})) {
      if (isValidModelPricing(value)) {
        models[key] = value;
      }
    }

    const fallback = isValidModelPricing(parsed.fallback) ? parsed.fallback : HARD_DEFAULT_FALLBACK;
    pricingCatalogCache = { models, fallback };
    return pricingCatalogCache;
  } catch (error) {
    console.warn(`[AI Billing] Could not load pricing catalog from ${pricingPath}. Falling back to hardcoded defaults.`, error);
    pricingCatalogCache = { models: {}, fallback: HARD_DEFAULT_FALLBACK };
    return pricingCatalogCache;
  }
}

function pricingMatchKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function findCatalogPricing(normalizedModel: string, candidates: string[]): ModelPricing | undefined {
  const catalog = loadPricingCatalog();
  const modelEntries = Object.entries(catalog.models);
  const normalizedNeedle = pricingMatchKey(normalizedModel);

  for (const candidate of candidates) {
    const direct = catalog.models[candidate]
      ?? catalog.models[candidate.toLowerCase()]
      ?? modelEntries.find(([key]) => pricingMatchKey(key) === pricingMatchKey(candidate))?.[1];
    if (direct) {
      return direct;
    }
  }

  // Use longest match to prefer more specific model keys (e.g. gpt-5.4-mini over gpt-5.4).
  const matched = modelEntries
    .filter(([key]) => normalizedNeedle.includes(pricingMatchKey(key)))
    .sort((a, b) => b[0].length - a[0].length)[0];

  return matched?.[1];
}

function hasUsage(usage: BillableUsage): boolean {
  return usage.input > 0 || usage.output > 0 || usage.cacheCreate > 0 || usage.cacheRead > 0;
}

function usageFromRecord(record: Pick<UsageRecord, 'input' | 'output' | 'cacheCreate' | 'cacheRead'>): BillableUsage {
  return {
    input: record.input,
    output: record.output,
    cacheCreate: record.cacheCreate,
    cacheRead: record.cacheRead,
  };
}

function creditsFromCost(costUsd: number): number {
  const creditPrice = Config.creditPriceUsd();
  if (creditPrice > 0) {
    return costUsd / creditPrice;
  }

  return costUsd;
}

function creditsOf(model: string, usage: BillableUsage): number {
  return creditsFromCost(costOf(model, usage));
}

function actualCostForRecord(record: UsageRecord): number {
  const usage = usageFromRecord(record);
  if (hasUsage(usage)) {
    return costOf(record.model, usage);
  }

  return record.costUsd;
}

function creditsForRecord(record: UsageRecord): number {
  if (Number.isFinite(record.requestUnits) && record.requestUnits > 0) {
    return record.requestUnits;
  }

  const usage = usageFromRecord(record);
  if (hasUsage(usage)) {
    return creditsOf(record.model, usage);
  }

  return Math.max(0, record.requestUnits || 0);
}

export function getModelRequestUnits(model: string): number {
  const pricing = getModelPricing(model);
  if (pricing.requestUnits && pricing.requestUnits > 0) {
    return pricing.requestUnits;
  }
  // Fallback to default weight
  return 1;
}

function getModelPricing(model: string): ModelPricing {
  const customPricing = vscode.workspace.getConfiguration('aiBilling').get<Record<string, ModelPricing>>('modelPricing', {});
  const modelKey = stripModelPrefix(model);
  const directCandidates = [model, modelKey, model.toLowerCase(), modelKey.toLowerCase()];

  for (const candidate of directCandidates) {
    if (customPricing[candidate]) {
      return customPricing[candidate];
    }
  }

  const matchedCustomEntry = Object.entries(customPricing).find(([key]) => key.toLowerCase() === modelKey.toLowerCase());
  if (matchedCustomEntry) {
    return matchedCustomEntry[1];
  }

  const normalizedModel = modelKey.toLowerCase();

  const catalogPricing = findCatalogPricing(normalizedModel, directCandidates);
  if (catalogPricing) {
    return catalogPricing;
  }

  return loadPricingCatalog().fallback;
}

let store: vscode.Memento | undefined;
let onChange: (() => void) | undefined;

export function initUsage(context: vscode.ExtensionContext, changed?: () => void): void {
  store = context.globalState;
  onChange = changed;
}

/**
 * Infers the vendor (metadata.vendor) from a model name.
 * Identifies which AI provider created the model: claude, copilot (GPT/o-series), ollama, or unknown.
 */
function inferProvider(model: string): UsageRecord['provider'] {
  const m = model.toLowerCase();
  if (m.startsWith('claude') || m.includes('anthropic')) {
    return 'claude';
  }
  if (m.startsWith('copilot:') || m.includes('gpt') || m.includes('o1') || m.includes('o3') || m.includes('o4')) {
    return 'copilot';
  }
  if (m.includes('llama') || m.includes('ollama')) {
    return 'ollama';
  }
  return 'unknown';
}

export function costOf(
  model: string,
  usage: BillableUsage,
): number {
  const pricing = getModelPricing(model);
  const cachedInRate = pricing.cachedIn || (pricing.in * 0.1);
  const cacheWriteRate = pricing.cacheWrite || (pricing.in * 1.25);
  
  return (
    (usage.input * pricing.in + 
     usage.cacheCreate * cacheWriteRate + 
     usage.cacheRead * cachedInRate + 
     usage.output * pricing.out) /
    1_000_000
  );
}

export function records(): UsageRecord[] {
  return store?.get<UsageRecord[]>(KEY, []) ?? [];
}

function forecastCostForRecord(r: UsageRecord, trendMultiplier = 1): number {
  const recalculated = actualCostForRecord(r);
  if (recalculated > 0 || hasUsage(usageFromRecord(r))) {
    // Forecast intentionally ignores discount and follows usage trend only.
    return Math.max(0, recalculated * trendMultiplier);
  }

  if (typeof r.costForecastUsd === 'number' && Number.isFinite(r.costForecastUsd) && r.costForecastUsd >= 0) {
    return Math.max(0, r.costForecastUsd * trendMultiplier);
  }

  return Math.max(0, actualCostForRecord(r) * trendMultiplier);
}

export async function recordUsage(args: RecordUsageArgs): Promise<void> {
  const usage = args.usage ?? {};
  const u = {
    input: usage.input_tokens ?? 0,
    output: usage.output_tokens ?? 0,
    cacheCreate: usage.cache_creation_input_tokens ?? 0,
    cacheRead: usage.cache_read_input_tokens ?? 0,
  };

  const provider = args.provider ?? inferProvider(args.model);
  const all = records();
  const now = args.ts ?? Date.now();

  const costUsd = typeof args.explicitCostUsd === 'number' ? args.explicitCostUsd : costOf(args.model, u);
  const hasExplicitRequestUnits =
    typeof args.requestUnits === 'number' && Number.isFinite(args.requestUnits) && args.requestUnits >= 0;
  const requestUnits = hasExplicitRequestUnits
    ? Math.max(0, args.requestUnits ?? 0)
    : hasUsage(u)
      ? creditsOf(args.model, u)
      : Math.max(0, creditsFromCost(costUsd));
  const costForecastUsd = costUsd;

  if (requestUnits > 0 || costUsd > 0) {
    console.log(
      `[AI Billing] Record: model=${args.model}, provider=${provider}, credits=${requestUnits}, costUsd=${costUsd}, costForecastUsd=${costForecastUsd}`,
    );
  }

  const rec: UsageRecord = { ts: now, provider, model: args.model, ...u, requestUnits, costUsd, costForecastUsd, isAutoModel: args.isAutoModel };
  all.push(rec);
  await store?.update(KEY, all.slice(-MAX_RECORDS));
  onChange?.();
}

export async function clearUsage(): Promise<void> {
  await store?.update(KEY, []);
  onChange?.();
}

export interface Totals {
  calls: number;
  input: number;
  output: number;
  cacheCreate: number;
  cacheRead: number;
  requestUnits: number;
  cost: number;
  costForecast: number;
}

export function totals(recs: UsageRecord[] = records()): Totals {
  const trendMultiplier = forecastMultiplierForRecords(recs);
  return recs.reduce<Totals>(
    (t, r) => ({
      calls: t.calls + 1,
      input: t.input + r.input,
      output: t.output + r.output,
      cacheCreate: t.cacheCreate + r.cacheCreate,
      cacheRead: t.cacheRead + r.cacheRead,
      requestUnits: t.requestUnits + creditsForRecord(r),
      cost: t.cost + actualCostForRecord(r),
      costForecast: t.costForecast + forecastCostForRecord(r, trendMultiplier),
    }),
    { calls: 0, input: 0, output: 0, cacheCreate: 0, cacheRead: 0, requestUnits: 0, cost: 0, costForecast: 0 },
  );
}

export function autoModelTotals(recs: UsageRecord[] = records()): Totals {
  return totals(recs.filter((r) => r.isAutoModel === true));
}

export function explicitModelTotals(recs: UsageRecord[] = records()): Totals {
  return totals(recs.filter((r) => r.isAutoModel !== true));
}

export function windowTotals(ms: number): Totals {
  const since = Date.now() - ms;
  return totals(records().filter((r) => r.ts >= since));
}

export function windowAutoModelTotals(ms: number): Totals {
  const since = Date.now() - ms;
  return autoModelTotals(records().filter((r) => r.ts >= since));
}

export function windowExplicitModelTotals(ms: number): Totals {
  const since = Date.now() - ms;
  return explicitModelTotals(records().filter((r) => r.ts >= since));
}

export interface DayBucket {
  date: string;
  cost: number;
  costForecast: number;
  input: number;
  output: number;
}

const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function dailySeries(days = 14): DayBucket[] {
  const buckets = new Map<string, DayBucket>();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    buckets.set(dayKey(d), { date: dayKey(d), cost: 0, costForecast: 0, input: 0, output: 0 });
  }

  const recs = records();
  for (const r of recs) {
    const d = new Date(r.ts);
    d.setHours(0, 0, 0, 0);
    const bucket = buckets.get(dayKey(d));
    if (bucket) {
      bucket.cost += actualCostForRecord(r);
      bucket.input += r.input;
      bucket.output += r.output;
    }
  }

  const bucketList = [...buckets.values()];
  const trendCosts = trendSeries(bucketList.map((b) => b.cost));
  for (let i = 0; i < bucketList.length; i++) {
    // Trend forecast excludes discount and uses regression over actual costs.
    bucketList[i].costForecast = trendCosts[i];
  }

  return bucketList;
}

export function modelMetrics(recs: UsageRecord[] = records()): ModelMetrics[] {
  const metricsMap = new Map<string, ModelMetrics>();
  const trendMultiplier = forecastMultiplierForRecords(recs);

  const routingOf = (record: UsageRecord): 'auto' | 'explicit' => {
    if (record.isAutoModel === true) {
      return 'auto';
    }
    // Treat unclassified (where isAutoModel is neither true nor false) as explicit
    return 'explicit';
  };

  for (const r of recs) {
    const routing = routingOf(r);
    const baseModel = prettifyModelName(r.model) || r.model;
    const key = `${routing}|${baseModel}|${r.provider}`;
    if (!metricsMap.has(key)) {
      metricsMap.set(key, {
        model: routing === 'auto' ? `Auto: ${baseModel}` : baseModel,
        baseModel,
        routing,
        provider: r.provider,
        calls: 0,
        input: 0,
        output: 0,
        requestUnits: 0,
        cost: 0,
        costForecast: 0,
      });
    }

    const m = metricsMap.get(key)!;
    m.calls += 1;
    m.input += r.input;
    m.output += r.output;
    m.requestUnits += creditsForRecord(r);
    m.cost += actualCostForRecord(r);
    m.costForecast += forecastCostForRecord(r, trendMultiplier);
  }

  // Sort by forecast cost descending
  return [...metricsMap.values()].sort((a, b) => b.costForecast - a.costForecast);
}

export function modelComparisonMetrics(recs: UsageRecord[] = records()): ModelComparisonMetrics[] {
  const metricsMap = new Map<string, ModelComparisonMetrics>();
  const trendMultiplier = forecastMultiplierForRecords(recs);

  for (const r of recs) {
    const baseModel = prettifyModelName(r.model) || r.model;
    if (!metricsMap.has(baseModel)) {
      metricsMap.set(baseModel, {
        model: baseModel,
        calls: 0,
        autoCredits: 0,
        explicitCredits: 0,
        totalCredits: 0,
        cost: 0,
        costForecast: 0,
        discountApplied: 0,
      });
    }

    const m = metricsMap.get(baseModel)!;
    const credits = creditsForRecord(r);
    m.calls += 1;
    m.totalCredits += credits;
    m.cost += actualCostForRecord(r);
    m.costForecast += forecastCostForRecord(r, trendMultiplier);
    m.discountApplied = (m.discountApplied || 0) + (r.appliedDiscountPercent || 0);

    if (r.isAutoModel === true) {
      m.autoCredits += credits;
    } else {
      // Treat unclassified (isAutoModel === undefined) as explicit
      m.explicitCredits += credits;
    }
  }

  return [...metricsMap.values()].sort((a, b) => b.costForecast - a.costForecast);
}

/**
 * Aggregates metrics by vendor (family).
 * Shows total usage and costs per AI provider (Claude, Copilot, etc.)
 * with auto/explicit routing split.
 */
export function vendorMetrics(recs: UsageRecord[] = records()): VendorMetrics[] {
  const metricsMap = new Map<string, VendorMetrics>();
  const trendMultiplier = forecastMultiplierForRecords(recs);

  for (const r of recs) {
    const vendor = r.provider;
    const key = vendor;
    if (!metricsMap.has(key)) {
      metricsMap.set(key, {
        vendor,
        calls: 0,
        autoCredits: 0,
        explicitCredits: 0,
        totalCredits: 0,
        cost: 0,
        costForecast: 0,
        discountApplied: 0,
      });
    }

    const m = metricsMap.get(key)!;
    const credits = creditsForRecord(r);
    m.calls += 1;
    m.totalCredits += credits;
    m.cost += actualCostForRecord(r);
    m.costForecast += forecastCostForRecord(r, trendMultiplier);
    m.discountApplied = (m.discountApplied || 0) + (r.appliedDiscountPercent || 0);

    if (r.isAutoModel === true) {
      m.autoCredits += credits;
    } else {
      m.explicitCredits += credits;
    }
  }

  // Sort by forecast descending; discount is intentionally excluded from forecast.
  return [...metricsMap.values()].sort((a, b) => b.costForecast - a.costForecast);
}