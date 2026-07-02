import * as fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { Config } from './config';
import { recordUsage } from './usage';

const IMPORTED_TURN_IDS_KEY = 'aiBilling.chatImportedTurnIds';
const IMPORT_STATS_KEY = 'aiBilling.chatImportStats';
const SYNC_INTERVAL_MS = 60_000;
const MATCH_WINDOW_MS = 5 * 60_000;

interface DebugUsageEntry {
  id: string;
  ts: number;
  source: 'debug-log' | 'debug-view' | 'chat-session';
  // family: the model identifier extracted from the source
  model?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  // detail: credit cost from chatSessions.request.result.details field
  aiCredits?: number;
  // metadata.name: indicates if this was auto-routed (copilot/auto)
  isAutoModel?: boolean;
}

interface TranscriptTurn {
  id: string;
  ts: number;
  userText: string;
  assistantText: string;
  userTokens?: number;
  assistantTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  modelOverride?: string;
  aiCredits?: number;
}

interface RequestLogEntry {
  ts: number;
  model: string;
}

function numericKeyPart(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'undef';
  }
  return value.toFixed(9).replace(/\.?0+$/, '');
}

function createSyncTurnDedupeKey(args: {
  ts: number;
  modelName: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  requestUnits?: number;
  isAutoModel?: boolean;
}): string {
  const model = normaliseModelName(args.modelName).toLowerCase();
  return [
    'copilot-sync',
    String(args.ts),
    model,
    String(args.inputTokens),
    String(args.outputTokens),
    String(args.cacheReadTokens),
    String(args.cacheWriteTokens),
    numericKeyPart(args.requestUnits),
    args.isAutoModel === true ? 'auto' : 'explicit',
  ].join('|');
}

export interface ChatImportStats {
  importedFromDebugView: number;
  importedFromDebugLogs: number;
  importedFromTranscriptTokens: number;
  skippedNonAuthoritative: number;
  lastSyncAt?: number;
  lastRunFoundTurns?: number;
}

let lastImportStats: ChatImportStats = {
  importedFromDebugView: 0,
  importedFromDebugLogs: 0,
  importedFromTranscriptTokens: 0,
  skippedNonAuthoritative: 0,
};

let importedIdsStore: vscode.Memento | undefined;
let syncTimer: NodeJS.Timeout | undefined;
let activeSync: Promise<void> | undefined;
let activeSyncId: string | undefined;
let syncRunCounter = 0;
let diagnosticsChannel: vscode.OutputChannel | undefined;

function diagnosticsEnabled(): boolean {
  return Config.diagnosticsEnabled();
}

function getDiagnosticsChannel(): vscode.OutputChannel {
  diagnosticsChannel ??= vscode.window.createOutputChannel('AI Billing Diagnostics');
  return diagnosticsChannel;
}

function createSyncRunId(): string {
  syncRunCounter += 1;
  return `sync-${Date.now()}-${syncRunCounter}`;
}

function diagnosticLog(message: string, context?: Record<string, unknown>, syncId?: string): void {
  if (!diagnosticsEnabled()) {
    return;
  }

  const mergedContext = syncId
    ? (context ? { syncId, ...context } : { syncId })
    : context;

  const line = mergedContext && Object.keys(mergedContext).length > 0
    ? `[AI Billing][ChatImport] ${message} ${JSON.stringify(mergedContext)}`
    : `[AI Billing][ChatImport] ${message}`;

  getDiagnosticsChannel().appendLine(line);

  if (context && Object.keys(context).length > 0) {
    console.log(line);
    return;
  }

  console.log(line);
}

export function initChatImport(context: vscode.ExtensionContext): void {
  importedIdsStore = context.globalState;
  lastImportStats = importedIdsStore.get<ChatImportStats>(IMPORT_STATS_KEY, lastImportStats);
  void syncChatUsage();

  syncTimer = setInterval(() => {
    void syncChatUsage();
  }, SYNC_INTERVAL_MS);

  context.subscriptions.push(
    {
      dispose: () => {
        if (diagnosticsChannel) {
          diagnosticsChannel.dispose();
          diagnosticsChannel = undefined;
        }
      },
    },
    vscode.window.onDidChangeWindowState((state) => {
      if (state.focused) {
        void syncChatUsage();
      }
    }),
    {
      dispose: () => {
        if (syncTimer) {
          clearInterval(syncTimer);
          syncTimer = undefined;
        }
      },
    },
  );
}

export function disposeChatImport(): void {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = undefined;
  }
}

export async function clearChatImportState(): Promise<void> {
  await importedIdsStore?.update(IMPORTED_TURN_IDS_KEY, []);
}

export function showChatImportDiagnosticsOutput(): void {
  getDiagnosticsChannel().show(true);
}

export async function syncChatUsage(): Promise<void> {
  if (activeSync) {
    diagnosticLog('sync skipped because a previous sync is still running', undefined, activeSyncId);
    return activeSync;
  }

  const syncId = createSyncRunId();
  activeSyncId = syncId;
  diagnosticLog('sync started', undefined, syncId);
  activeSync = doSyncChatUsage(syncId).finally(() => {
    diagnosticLog('sync finished', undefined, syncId);
    activeSyncId = undefined;
    activeSync = undefined;
  });

  return activeSync;
}

export function getChatImportStats(): ChatImportStats {
  return { ...lastImportStats };
}

export async function importDebugViewText(raw: string): Promise<{ imported: number; skipped: number }> {
  const lines = raw.split(/\r?\n/);
  let pendingModel: string | undefined;
  let imported = 0;
  let skipped = 0;

  for (const line of lines) {
    const modelMatch = /resolved model\s*:\s*(.+)$/i.exec(line);
    if (modelMatch?.[1]) {
      pendingModel = normaliseModelName(modelMatch[1].trim());
      continue;
    }

    const usageMatch = /\busage\s*:\s*(\{.*\})\s*$/i.exec(line);
    if (!usageMatch?.[1]) {
      continue;
    }

    let usage: any;
    try {
      usage = JSON.parse(usageMatch[1]);
    } catch {
      skipped += 1;
      continue;
    }

    const extracted = extractTokenBreakdown(usage);
    if (!extracted) {
      skipped += 1;
      continue;
    }

    const modelName = normaliseModelName(pendingModel?.trim() || 'unknown-chat');
    await recordUsage({
      model: `copilot:${modelName}`,
      usage: {
        input_tokens: extracted.inputTokens,
        output_tokens: extracted.outputTokens,
        cache_creation_input_tokens: extracted.cacheWriteTokens,
        cache_read_input_tokens: extracted.cacheReadTokens,
      },
      provider: 'copilot',
      requestUnits: extracted.aiCredits,
      ts: Date.now(),
    });
    imported += 1;
  }

  lastImportStats = {
    importedFromDebugView: imported,
    importedFromDebugLogs: 0,
    importedFromTranscriptTokens: 0,
    skippedNonAuthoritative: skipped,
    lastRunFoundTurns: imported + skipped,
    lastSyncAt: Date.now(),
  };
  await importedIdsStore?.update(IMPORT_STATS_KEY, lastImportStats);

  diagnosticLog('manual debug-view import completed', {
    imported,
    skipped,
    lines: lines.length,
  });

  return { imported, skipped };
}

async function doSyncChatUsage(syncId: string): Promise<void> {
  if (!importedIdsStore) {
    diagnosticLog('sync aborted because global state store is unavailable', undefined, syncId);
    return;
  }

  const startedAt = Date.now();

  const transcriptFiles = await findTranscriptFiles();
  diagnosticLog('transcript discovery completed', { transcriptFiles: transcriptFiles.length }, syncId);
  if (!transcriptFiles.length) {
    lastImportStats = {
      importedFromDebugView: 0,
      importedFromDebugLogs: 0,
      importedFromTranscriptTokens: 0,
      skippedNonAuthoritative: 0,
      lastRunFoundTurns: 0,
      lastSyncAt: Date.now(),
    };
    await importedIdsStore.update(IMPORT_STATS_KEY, lastImportStats);
    diagnosticLog('sync completed with no transcript files', { durationMs: Date.now() - startedAt }, syncId);
    return;
  }

  const importedIds = new Set(importedIdsStore.get<string[]>(IMPORTED_TURN_IDS_KEY, []));
  const importedIdsBefore = importedIds.size;
  const turns = (await Promise.all(transcriptFiles.map((filePath) => parseTranscriptTurns(filePath))))
    .flat()
    .filter((turn) => !importedIds.has(turn.id))
    .sort((a, b) => a.ts - b.ts);

  diagnosticLog('turn extraction completed', {
    candidateTurns: turns.length,
    alreadyImportedTurns: importedIdsBefore,
  }, syncId);

  if (!turns.length) {
    lastImportStats = {
      importedFromDebugView: 0,
      importedFromDebugLogs: 0,
      importedFromTranscriptTokens: 0,
      skippedNonAuthoritative: 0,
      lastRunFoundTurns: 0,
      lastSyncAt: Date.now(),
    };
    await importedIdsStore.update(IMPORT_STATS_KEY, lastImportStats);
    diagnosticLog('sync completed with no new turns', { durationMs: Date.now() - startedAt }, syncId);
    return;
  }

  const requests = (await readCopilotRequestLogEntries()).sort((a, b) => a.ts - b.ts);
  const debugUsages = [
    ...(await readCopilotDebugUsageEntries()),
    ...(await readCopilotDebugViewUsageEntries()),
    ...(await readChatSessionCredits()),
  ].sort((a, b) => a.ts - b.ts);
  diagnosticLog('reference source loading completed', {
    requestLogEntries: requests.length,
    debugUsageEntries: debugUsages.length,
  }, syncId);
  let skippedNonAuthoritative = 0;
  let importedFromDebugView = 0;
  let importedFromDebugLogs = 0;
  let importedFromTranscriptTokens = 0;

  for (const turn of turns) {
    const modelName = normaliseModelName(turn.modelOverride ?? matchRequestModel(turn, requests) ?? 'unknown-chat');

    const debugUsage = consumeBestDebugUsage(turn, modelName, debugUsages);
    const hasExplicitTranscriptTokens =
      (typeof turn.userTokens === 'number' && Number.isFinite(turn.userTokens) && turn.userTokens >= 0) ||
      (typeof turn.assistantTokens === 'number' && Number.isFinite(turn.assistantTokens) && turn.assistantTokens >= 0) ||
      (typeof turn.cacheReadTokens === 'number' && Number.isFinite(turn.cacheReadTokens) && turn.cacheReadTokens > 0) ||
      (typeof turn.cacheWriteTokens === 'number' && Number.isFinite(turn.cacheWriteTokens) && turn.cacheWriteTokens > 0) ||
      (typeof turn.aiCredits === 'number' && Number.isFinite(turn.aiCredits) && turn.aiCredits >= 0);

    // Billing-grade imports must use authoritative tokens. Skip estimated turns.
    if (!debugUsage && !hasExplicitTranscriptTokens) {
      skippedNonAuthoritative += 1;
      continue;
    }

    const inputTokens = debugUsage?.inputTokens ?? turn.userTokens ?? 0;
    const outputTokens = debugUsage?.outputTokens ?? turn.assistantTokens ?? 0;
    const cacheReadTokens = debugUsage?.cacheReadTokens ?? turn.cacheReadTokens ?? 0;
    const cacheWriteTokens = debugUsage?.cacheWriteTokens ?? turn.cacheWriteTokens ?? 0;

    const requestUnits = debugUsage?.aiCredits ?? turn.aiCredits;
    const inserted = await recordUsage({
      model: `copilot:${modelName}`,
      usage: {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cache_creation_input_tokens: cacheWriteTokens,
        cache_read_input_tokens: cacheReadTokens,
      },
      provider: 'copilot',
      requestUnits,
      ts: turn.ts,
      isAutoModel: debugUsage?.isAutoModel,
      dedupeKey: createSyncTurnDedupeKey({
        ts: turn.ts,
        modelName,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheWriteTokens,
        requestUnits,
        isAutoModel: debugUsage?.isAutoModel,
      }),
    });

    if (!inserted) {
      importedIds.add(turn.id);
      continue;
    }

    if (turn.id.includes(':debug:')) {
      importedFromDebugView += 1;
    } else if (debugUsage) {
      importedFromDebugLogs += 1;
    } else {
      importedFromTranscriptTokens += 1;
    }

    importedIds.add(turn.id);
  }

  if (skippedNonAuthoritative > 0) {
    console.log(`[AI Billing] Skipped ${skippedNonAuthoritative} Copilot turns without authoritative token usage.`);
  }

  lastImportStats = {
    importedFromDebugView,
    importedFromDebugLogs,
    importedFromTranscriptTokens,
    skippedNonAuthoritative,
    lastRunFoundTurns: turns.length,
    lastSyncAt: Date.now(),
  };
  await importedIdsStore.update(IMPORT_STATS_KEY, lastImportStats);

  await importedIdsStore.update(IMPORTED_TURN_IDS_KEY, Array.from(importedIds).slice(-5000));

  diagnosticLog('sync metrics', {
    importedFromDebugView,
    importedFromDebugLogs,
    importedFromTranscriptTokens,
    skippedNonAuthoritative,
    turnsProcessed: turns.length,
    importedIdsBefore,
    importedIdsAfter: importedIds.size,
    durationMs: Date.now() - startedAt,
  }, syncId);
}

async function readCopilotDebugUsageEntries(): Promise<DebugUsageEntry[]> {
  const workspaceStorageDir = path.join(vscodeUserDir(), 'workspaceStorage');
  const workspaceEntries = await safeReadDir(workspaceStorageDir);
  const entries: DebugUsageEntry[] = [];

  for (const wsEntry of workspaceEntries) {
    if (!wsEntry.isDirectory()) {
      continue;
    }

    const debugLogsRoot = path.join(workspaceStorageDir, wsEntry.name, 'GitHub.copilot-chat', 'debug-logs');
    const sessionEntries = await safeReadDir(debugLogsRoot);

    for (const sessionEntry of sessionEntries) {
      if (!sessionEntry.isDirectory()) {
        continue;
      }

      const mainLogPath = path.join(debugLogsRoot, sessionEntry.name, 'main.jsonl');
      const text = await safeReadText(mainLogPath);
      if (!text) {
        continue;
      }

      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) {
          continue;
        }

        let parsed: any;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue;
        }

        const usage = extractUsageObject(parsed);
        if (!usage) {
          continue;
        }

        const extracted = extractTokenBreakdown(usage);
        if (!extracted) {
          continue;
        }

        const ts = parseTimestamp(parsed?.ts ?? parsed?.timestamp ?? parsed?.attrs?.timestamp);
        if (!Number.isFinite(ts)) {
          continue;
        }

        const id = String(parsed?.spanId ?? parsed?.id ?? `${mainLogPath}:${ts}`);
        const model = extractModelName(parsed);
        entries.push({
          id,
          ts,
          source: 'debug-log',
          model,
          inputTokens: extracted.inputTokens,
          outputTokens: extracted.outputTokens,
          cacheReadTokens: extracted.cacheReadTokens,
          cacheWriteTokens: extracted.cacheWriteTokens,
          aiCredits: extracted.aiCredits,
        });
      }
    }
  }

  return entries;
}

function consumeBestDebugUsage(
  turn: TranscriptTurn,
  modelName: string,
  usages: DebugUsageEntry[],
): DebugUsageEntry | undefined {
  if (!usages.length) {
    return undefined;
  }

  const wanted = normaliseModelNeedle(modelName);
  let bestIndex = -1;
  let bestDistance = Number.POSITIVE_INFINITY;

  const sourcePriority = (source: DebugUsageEntry['source']): number => {
    if (source === 'chat-session') {
      return 3;
    }
    if (source === 'debug-view') {
      return 2;
    }
    return 1;
  };

  for (let i = 0; i < usages.length; i += 1) {
    const candidate = usages[i];
    const distance = Math.abs(candidate.ts - turn.ts);
    if (distance > MATCH_WINDOW_MS) {
      continue;
    }

    if (wanted && candidate.model) {
      const got = normaliseModelNeedle(candidate.model);
      // Treat routing/unknown model names as wildcards — match by timestamp only.
      const wantedIsGeneric = wanted === 'unknown chat' || wanted === 'unknown';
      const gotIsGeneric = got === 'copilot auto' || got === 'auto' || got === 'unknown';
      if (got && !wantedIsGeneric && !gotIsGeneric && !got.includes(wanted) && !wanted.includes(got)) {
        continue;
      }
    }

    if (bestIndex < 0 || distance < bestDistance) {
      bestIndex = i;
      bestDistance = distance;
      continue;
    }

    if (distance > bestDistance) {
      continue;
    }

    const best = usages[bestIndex];
    const bestPriority = sourcePriority(best.source);
    const candidatePriority = sourcePriority(candidate.source);

    if (candidatePriority > bestPriority) {
      bestIndex = i;
      continue;
    }

    if (candidatePriority < bestPriority) {
      continue;
    }

    const bestHasCredits = typeof best.aiCredits === 'number' && Number.isFinite(best.aiCredits) && best.aiCredits > 0;
    const candidateHasCredits =
      typeof candidate.aiCredits === 'number' && Number.isFinite(candidate.aiCredits) && candidate.aiCredits > 0;

    if (candidateHasCredits && !bestHasCredits) {
      bestIndex = i;
    }
  }

  if (bestIndex < 0) {
    return undefined;
  }

  const [best] = usages.splice(bestIndex, 1);
  return best;
}

function extractUsageObject(parsed: any): any | undefined {
  const candidates = [
    parsed?.usage,
    parsed?.data?.usage,
    parsed?.attrs?.usage,
    parsed?.attrs?.response?.usage,
    parsed?.attrs?.result?.usage,
  ];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    if (typeof candidate === 'object') {
      return candidate;
    }
    if (typeof candidate === 'string') {
      try {
        const decoded = JSON.parse(candidate);
        if (decoded && typeof decoded === 'object') {
          return decoded;
        }
      } catch {
        // Ignore malformed inline JSON usage strings.
      }
    }
  }

  return undefined;
}

function extractModelName(parsed: any): string | undefined {
  const candidates = [
    parsed?.model,
    parsed?.data?.model,
    parsed?.attrs?.model,
    parsed?.attrs?.resolvedModel,
    parsed?.attrs?.['resolved model'],
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  return undefined;
}

function extractTokenBreakdown(usage: any):
  | { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; aiCredits?: number }
  | undefined {
  const tokenDetails = usage?.copilot_usage?.token_details ?? usage?.token_details;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  const nanoAiu = typeof usage?.copilot_usage?.total_nano_aiu === 'number'
    ? usage.copilot_usage.total_nano_aiu
    : typeof usage?.total_nano_aiu === 'number'
      ? usage.total_nano_aiu
      : undefined;
  const aiCredits = typeof nanoAiu === 'number' && Number.isFinite(nanoAiu) && nanoAiu >= 0
    ? nanoAiu / 1_000_000_000
    : undefined;

  if (Array.isArray(tokenDetails)) {
    for (const detail of tokenDetails) {
      const tokenCount = typeof detail?.token_count === 'number' ? detail.token_count : 0;
      const tokenType = String(detail?.token_type ?? '').toLowerCase();
      if (!Number.isFinite(tokenCount) || tokenCount <= 0) {
        continue;
      }

      if (tokenType === 'input') {
        inputTokens += tokenCount;
      } else if (tokenType === 'output') {
        outputTokens += tokenCount;
      } else if (tokenType === 'cache_read') {
        cacheReadTokens += tokenCount;
      } else if (tokenType === 'cache_write') {
        cacheWriteTokens += tokenCount;
      }
    }
  }

  if (inputTokens || outputTokens || cacheReadTokens || cacheWriteTokens) {
    return { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, aiCredits };
  }

  const promptTokens = typeof usage?.prompt_tokens === 'number' ? usage.prompt_tokens : 0;
  const completionTokens = typeof usage?.completion_tokens === 'number' ? usage.completion_tokens : 0;
  const cachedPromptTokens =
    typeof usage?.prompt_tokens_details?.cached_tokens === 'number' ? usage.prompt_tokens_details.cached_tokens : 0;

  if (promptTokens <= 0 && completionTokens <= 0 && cachedPromptTokens <= 0) {
    return undefined;
  }

  const nonCachedInput = Math.max(0, promptTokens - cachedPromptTokens);
  return {
    inputTokens: nonCachedInput,
    outputTokens: Math.max(0, completionTokens),
    cacheReadTokens: Math.max(0, cachedPromptTokens),
    cacheWriteTokens: 0,
    aiCredits,
  };
}

/**
 * Parses a credit value from a chatSession request.result.details string.
 * The field looks like: "GPT-5.3-Codex • 2.0 credits" or "Claude Sonnet 4.6 • 4.7 credits".
 * This field is treated as the authoritative chatSessions source for Copilot credits.
 */
function parseCreditsFromChatSessionDetails(details: unknown): number | undefined {
  if (typeof details !== 'string' || !details) {
    return undefined;
  }
  const match = /(?:^|[^\d.])(\d+(?:\.\d+)?)\s+credits?\b/i.exec(details);
  if (!match) {
    return undefined;
  }
  const credits = Number(match[1]);
  return Number.isFinite(credits) && credits >= 0 ? credits : undefined;
}

/**
 * Extracts the displayed model name from a chatSession details string.
 * E.g. "GPT-5.3-Codex • 4.0 credits" → "GPT-5.3-Codex"
 *      "Claude Sonnet 4.6 • 4.7 credits" → "Claude Sonnet 4.6"
 */
function parseModelFromCreditDetails(details: string): string | undefined {
  if (!details) {
    return undefined;
  }
  const bulletIdx = details.indexOf(' \u2022 ');
  if (bulletIdx > 0) {
    return details.slice(0, bulletIdx).trim() || undefined;
  }
  return undefined;
}

/**
 * Normalise model names by removing version dates and other noise.
 * E.g. "claude-haiku-4-5-20251001" → "claude-haiku-4-5"
 *      "gpt-5.4-2026-03-05" → "gpt-5.4"
 */
function normaliseModelName(model: string): string {
  if (!model) return model;
  // Remove trailing date patterns (YYYY-MM-DD / YYYY.MM.DD / YYYYMMDD), including space-delimited dates.
  return model.replace(/[\s\-._]?(?:\(?20\d{2}[-._]?\d{2}[-._]?\d{2}\)?)$/i, '').trim();
}

/**
 * Reads chatSessions JSONL files and extracts both model name and credit value
 * from request.result.details.
 * Returns a list of DebugUsageEntry using chatSessions as an authoritative local source.
 * The session ID is the filename without extension; timestamps come from request.timestamp.
 */
async function readChatSessionCredits(): Promise<DebugUsageEntry[]> {
  const workspaceStorageDir = path.join(vscodeUserDir(), 'workspaceStorage');
  const workspaceEntries = await safeReadDir(workspaceStorageDir);
  const entries: DebugUsageEntry[] = [];

  for (const wsEntry of workspaceEntries) {
    if (!wsEntry.isDirectory()) {
      continue;
    }

    const chatSessionsDir = path.join(workspaceStorageDir, wsEntry.name, 'chatSessions');
    const sessionFiles = await safeReadDir(chatSessionsDir);

    for (const sessionFile of sessionFiles) {
      if (!sessionFile.isFile() || !sessionFile.name.endsWith('.jsonl')) {
        continue;
      }

      const filePath = path.join(chatSessionsDir, sessionFile.name);
      const text = await safeReadText(filePath);
      if (!text) {
        continue;
      }

      // Reconstruct the rolling state from the JSONL delta-patch format
      let state: any = {};
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) {
          continue;
        }
        let raw: any;
        try {
          raw = JSON.parse(line);
        } catch {
          continue;
        }

        // kind=0: full reset
        if (raw.kind === 0 && raw.v && typeof raw.v === 'object') {
          state = raw.v;
          continue;
        }

        // kind=1: set nested value
        // kind=2: push to array
        if (!Array.isArray(raw.k)) {
          continue;
        }

        let cursor = state;
        for (let i = 0; i < raw.k.length - 1; i++) {
          const key = raw.k[i];
          if (cursor[key] === undefined || cursor[key] === null) {
            cursor[key] = typeof raw.k[i + 1] === 'number' ? [] : {};
          }
          cursor = cursor[key];
        }

        const lastKey = raw.k[raw.k.length - 1];
        if (raw.kind === 2) {
          // Array push: ensure it's an array and append
          if (!Array.isArray(cursor[lastKey])) {
            cursor[lastKey] = [];
          }
          if (Array.isArray(raw.v)) {
            cursor[lastKey].push(...raw.v);
          } else {
            cursor[lastKey].push(raw.v);
          }
        } else {
          // kind=1: regular set
          cursor[lastKey] = raw.v;
        }
      }

      const requests: any[] = Array.isArray(state.requests) ? state.requests : [];
      for (let i = 0; i < requests.length; i++) {
        const request = requests[i];
        if (!request || typeof request !== 'object') {
          continue;
        }

        const aiCredits = parseCreditsFromChatSessionDetails(request.result?.details);
        if (aiCredits === undefined) {
          continue;
        }

        const ts = parseTimestamp(request.timestamp) || parseTimestamp(state.creationDate) || Date.now();
        // Extract family (model name) from chatSessions details field (preferred source)
        const detailsModel = parseModelFromCreditDetails(request.result?.details ?? '');
        // Prefer the user-facing details string because modelId is often only `copilot/auto`.
        // Normalise fallback model names to remove version dates.
        const rawModel = detailsModel ?? request.modelId ?? request.model ?? 'unknown';
        const model = detailsModel ? rawModel : normaliseModelName(rawModel);
        // metadata.name: true if auto-routed, false/undefined if explicitly selected
        const isAutoModel = request.modelId === 'copilot/auto';
        // vendor is inferred from model name by inferProvider() in usage.ts
        const idModel = model.toLowerCase().replace(/[^a-z0-9]+/g, '-');

        entries.push({
          id: `chatsession:${sessionFile.name}:${i}:${idModel}`,
          ts,
          source: 'chat-session',
          model,
          inputTokens: typeof request.result?.metadata?.promptTokens === 'number' ? request.result.metadata.promptTokens : 0,
          outputTokens: typeof request.result?.metadata?.outputTokens === 'number' ? request.result.metadata.outputTokens : 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          aiCredits,
          isAutoModel,
        });
      }
    }
  }

  return entries;
}

async function findTranscriptFiles(): Promise<string[]> {
  const workspaceStorageDir = path.join(vscodeUserDir(), 'workspaceStorage');
  const workspaceEntries = await safeReadDir(workspaceStorageDir);
  const files: string[] = [];

  for (const entry of workspaceEntries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const transcriptsDir = path.join(workspaceStorageDir, entry.name, 'GitHub.copilot-chat', 'transcripts');
    const transcriptEntries = await safeReadDir(transcriptsDir);
    for (const transcript of transcriptEntries) {
      if (transcript.isFile() && transcript.name.endsWith('.jsonl')) {
        files.push(path.join(transcriptsDir, transcript.name));
      }
    }
  }

  return files;
}

async function parseTranscriptTurns(filePath: string): Promise<TranscriptTurn[]> {
  const text = await safeReadText(filePath);
  if (!text) {
    return [];
  }

  const turns: TranscriptTurn[] = [];
  let pendingUser: { ts: number; text: string } | undefined;

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    let parsed: any;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }

    const timestamp = parseTimestamp(parsed?.timestamp);
    if (!Number.isFinite(timestamp)) {
      continue;
    }

    if (parsed?.type === 'user.message') {
      const content = String(parsed?.data?.content ?? '').trim();
      const userMessageId = String(parsed?.data?.messageId ?? parsed?.id ?? `${filePath}:${timestamp}:user`);
      turns.push(...extractDebugUsageTurnsFromText(content, timestamp, userMessageId));
      if (content) {
        pendingUser = { ts: timestamp, text: content };
      }
      continue;
    }

    if (parsed?.type === 'assistant.message' && pendingUser) {
      const content = String(parsed?.data?.content ?? '').trim();
      const assistantMessageId = String(parsed?.data?.messageId ?? parsed?.id ?? `${filePath}:${timestamp}:assistant`);
      const debugTurns = extractDebugUsageTurnsFromText(content, timestamp, assistantMessageId);
      turns.push(...debugTurns);
      if (!content) {
        continue;
      }

      // When debug usage blocks are present in the assistant payload, those entries
      // are the authoritative billing records. Skip creating the generic assistant
      // turn to avoid counting the same response twice.
      if (debugTurns.length > 0) {
        pendingUser = undefined;
        continue;
      }

      turns.push({
        id: String(parsed?.data?.messageId ?? parsed?.id ?? `${filePath}:${timestamp}`),
        ts: timestamp,
        userText: pendingUser.text,
        assistantText: content,
        userTokens: typeof parsed?.data?.tokens?.userInputTokens === 'number' ? parsed.data.tokens.userInputTokens : undefined,
        assistantTokens: typeof parsed?.data?.tokens?.assistantInputTokens === 'number' ? parsed.data.tokens.assistantInputTokens : undefined,
      });
      pendingUser = undefined;
    }
  }

  return turns;
}

function extractDebugUsageTurnsFromText(content: string, ts: number, baseId: string): TranscriptTurn[] {
  if (!content) {
    return [];
  }

  const turns: TranscriptTurn[] = [];
  let pendingModel: string | undefined;
  let idx = 0;

  for (const line of content.split(/\r?\n/)) {
    const modelMatch = /resolved model\s*:\s*(.+)$/i.exec(line);
    if (modelMatch?.[1]) {
      pendingModel = normaliseModelName(modelMatch[1].trim());
      continue;
    }

    const usageMatch = /\busage\s*:\s*(\{.*\})\s*$/i.exec(line);
    if (!usageMatch?.[1]) {
      continue;
    }

    let usage: any;
    try {
      usage = JSON.parse(usageMatch[1]);
    } catch {
      continue;
    }

    const extracted = extractTokenBreakdown(usage);
    if (!extracted) {
      continue;
    }

    idx += 1;
    turns.push({
      id: `${baseId}:debug:${idx}`,
      ts,
      userText: '',
      assistantText: '',
      userTokens: extracted.inputTokens,
      assistantTokens: extracted.outputTokens,
      cacheReadTokens: extracted.cacheReadTokens,
      cacheWriteTokens: extracted.cacheWriteTokens,
      modelOverride: pendingModel ? normaliseModelName(pendingModel) : undefined,
      aiCredits: extracted.aiCredits,
    });
  }

  return turns;
}

async function readCopilotRequestLogEntries(): Promise<RequestLogEntry[]> {
  const logsRoot = path.join(vscodeAppRoot(), 'logs');
  const logRoots = (await safeReadDir(logsRoot))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse();

  const allEntries: RequestLogEntry[] = [];

  for (const logRoot of logRoots) {
    const windowsDir = path.join(logsRoot, logRoot);
    const windowEntries = await safeReadDir(windowsDir);

    for (const entry of windowEntries) {
      if (!entry.isDirectory() || !entry.name.startsWith('window')) {
        continue;
      }

      const logFile = path.join(
        windowsDir,
        entry.name,
        'exthost',
        'GitHub.copilot-chat',
        'GitHub Copilot Chat.log',
      );
      const text = await safeReadText(logFile);
      if (!text) {
        continue;
      }

      allEntries.push(...parseRequestLogEntries(text));
    }
  }

  return allEntries;
}

async function readCopilotDebugViewUsageEntries(): Promise<DebugUsageEntry[]> {
  const logsRoot = path.join(vscodeAppRoot(), 'logs');
  const logRoots = (await safeReadDir(logsRoot))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse();

  const allEntries: DebugUsageEntry[] = [];

  // Pattern: ccreq:<id>.copilotmd | success | <model> | <ms>ms | [panel/editAgent]
  const ccreqPattern = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}).*\bccreq:([0-9a-f]+)\.copilotmd\b.*\[panel\/editAgent\]/;

  for (const logRoot of logRoots) {
    const windowsDir = path.join(logsRoot, logRoot);
    const windowEntries = await safeReadDir(windowsDir);

    for (const entry of windowEntries) {
      if (!entry.isDirectory() || !entry.name.startsWith('window')) {
        continue;
      }

      const logFile = path.join(
        windowsDir,
        entry.name,
        'exthost',
        'GitHub.copilot-chat',
        'GitHub Copilot Chat.log',
      );
      const text = await safeReadText(logFile);
      if (!text) {
        continue;
      }

      // First try parsing the log file directly for resolved model / usage lines
      const directEntries = parseDebugViewUsageEntries(text, logFile);
      if (directEntries.length > 0) {
        allEntries.push(...directEntries);
        continue;
      }

      // Fallback: log has ccreq: IDs but no inline usage — read each virtual file via VS Code API
      for (const line of text.split(/\r?\n/)) {
        const match = ccreqPattern.exec(line);
        if (!match) {
          continue;
        }

        const ts = parseTimestamp(match[1]);
        const ccreqId = match[2];
        if (!Number.isFinite(ts) || !ccreqId) {
          continue;
        }

        try {
          const uri = vscode.Uri.parse(`ccreq:${ccreqId}.copilotmd`);
          const doc = await vscode.workspace.openTextDocument(uri);
          const content = doc.getText();
          // The .copilotmd file has no log timestamp prefix — use dedicated parser
          const entry = parseCopilotMdUsageEntry(content, ccreqId, ts);
          if (entry) {
            allEntries.push(entry);
          }
        } catch {
          // Virtual file not available (e.g. session ended) — skip silently
        }
      }
    }
  }

  return allEntries;
}

function parseRequestLogEntries(text: string): RequestLogEntry[] {
  const entries: RequestLogEntry[] = [];
  const pattern = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}).*ccreq:[^|]+\| success \| ([^|]+) \|/;

  for (const line of text.split(/\r?\n/)) {
    const match = pattern.exec(line);
    if (!match) {
      continue;
    }

    const ts = parseTimestamp(match[1]);
    if (!Number.isFinite(ts)) {
      continue;
    }

    const rawModel = match[2].trim();
    const model = normaliseModelName(rawModel.includes('->') ? rawModel.split('->').pop()?.trim() || rawModel : rawModel);
    entries.push({ ts, model });
  }

  return entries;
}

/**
 * Parses usage data from a ccreq:*.copilotmd virtual file.
 * These files have no log timestamp prefix — lines are plain key: value pairs:
 *   resolved model   : claude-sonnet-4-6
 *   usage            : {"prompt_tokens":86753,...,"copilot_usage":{...}}
 */
function parseCopilotMdUsageEntry(content: string, ccreqId: string, ts: number): DebugUsageEntry | undefined {
  let model: string | undefined;
  let usage: any;

  for (const line of content.split(/\r?\n/)) {
    if (!model) {
      const modelMatch = /^resolved model\s*:\s*(.+)$/i.exec(line.trim());
      if (modelMatch?.[1]) {
        model = normaliseModelName(modelMatch[1].trim());
        continue;
      }
    }

    if (!usage) {
      const usageMatch = /^usage\s*:\s*(\{.*\})\s*$/i.exec(line.trim());
      if (usageMatch?.[1]) {
        try {
          usage = JSON.parse(usageMatch[1]);
        } catch {
          // malformed JSON — skip
        }
      }
    }

    if (model && usage) {
      break;
    }
  }

  if (!usage) {
    return undefined;
  }

  const extracted = extractTokenBreakdown(usage);
  if (!extracted) {
    return undefined;
  }

  const idModel = model ? normaliseModelNeedle(model) : 'unknown-model';
  return {
    id: `ccreq:${ccreqId}:${idModel}`,
    ts,
    source: 'debug-view',
    model,
    inputTokens: extracted.inputTokens,
    outputTokens: extracted.outputTokens,
    cacheReadTokens: extracted.cacheReadTokens,
    cacheWriteTokens: extracted.cacheWriteTokens,
    aiCredits: extracted.aiCredits,
  };
}

function parseDebugViewUsageEntries(text: string, source: string): DebugUsageEntry[] {
  const entries: DebugUsageEntry[] = [];
  let pendingModel: { model: string; ts: number } | undefined;

  for (const line of text.split(/\r?\n/)) {
    const parsedLine = parseLogLine(line);
    if (!parsedLine) {
      continue;
    }

    const modelMatch = /resolved model\s*:\s*(.+)$/i.exec(parsedLine.message);
    if (modelMatch?.[1]) {
      pendingModel = { model: normaliseModelName(modelMatch[1].trim()), ts: parsedLine.ts };
      continue;
    }

    const usageMatch = /\busage\s*:\s*(\{.*\})\s*$/i.exec(parsedLine.message);
    if (!usageMatch?.[1]) {
      continue;
    }

    let usage: any;
    try {
      usage = JSON.parse(usageMatch[1]);
    } catch {
      continue;
    }

    const extracted = extractTokenBreakdown(usage);
    if (!extracted) {
      continue;
    }

    const model = pendingModel?.model;
    const ts = parsedLine.ts;
    const idModel = model ? normaliseModelNeedle(model) : 'unknown-model';
    entries.push({
      id: `${source}:${ts}:${idModel}`,
      ts,
      source: 'debug-view',
      model,
      inputTokens: extracted.inputTokens,
      outputTokens: extracted.outputTokens,
      cacheReadTokens: extracted.cacheReadTokens,
      cacheWriteTokens: extracted.cacheWriteTokens,
      aiCredits: extracted.aiCredits,
    });
  }

  return entries;
}

function parseLogLine(line: string): { ts: number; message: string } | undefined {
  const match = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})\s+\[[^\]]+\]\s*(.*)$/.exec(line);
  if (!match) {
    return undefined;
  }

  const ts = parseTimestamp(match[1].replace(' ', 'T'));
  if (!Number.isFinite(ts)) {
    return undefined;
  }

  return { ts, message: match[2] };
}

function matchRequestModel(turn: TranscriptTurn, requests: RequestLogEntry[]): string | undefined {
  let best: RequestLogEntry | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const request of requests) {
    const distance = Math.abs(request.ts - turn.ts);
    if (distance > MATCH_WINDOW_MS || distance >= bestDistance) {
      continue;
    }
    best = request;
    bestDistance = distance;
  }

  return best?.model;
}

async function safeSelectChatModels(): Promise<vscode.LanguageModelChat[]> {
  try {
    return await vscode.lm.selectChatModels();
  } catch {
    return [];
  }
}

function findModelForName(models: vscode.LanguageModelChat[], modelName: string): vscode.LanguageModelChat | undefined {
  const needle = normaliseModelNeedle(modelName);
  return models.find((model) => {
    const haystack = normaliseModelNeedle(`${model.id} ${model.family} ${model.name}`);
    return haystack.includes(needle) || needle.includes(normaliseModelNeedle(model.id));
  });
}

async function countTextTokens(model: vscode.LanguageModelChat | undefined, text: string): Promise<number> {
  const trimmed = text.trim();
  if (!trimmed) {
    return 0;
  }

  if (model) {
    try {
      return await model.countTokens(trimmed, new vscode.CancellationTokenSource().token);
    } catch {
      // Fall back to a coarse estimate if retrospective counting is unavailable.
    }
  }

  return estimateTokens(trimmed);
}

function estimateTokens(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) {
    return 0;
  }
  return Math.max(1, Math.ceil(trimmed.length / 3));
}

function normaliseModelNeedle(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function parseTimestamp(value: unknown): number {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return Number.NaN;
}

function vscodeUserDir(): string {
  return path.join(vscodeAppRoot(), 'User');
}

function vscodeAppRoot(): string {
  return Config.vscodeDataPath();
}

async function safeReadDir(dirPath: string): Promise<Dirent[]> {
  try {
    return await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function safeReadText(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return undefined;
  }
}