import * as vscode from 'vscode';
import {
  clearChatImportState,
  disposeChatImport,
  importDebugViewText,
  initChatImport,
  showChatImportDiagnosticsOutput,
  syncChatUsage,
} from './chatImport';
import {
  billingPeriodTotals,
  clearUsage,
  currentBillingPeriodRange,
  initUsage,
  recordUsage,
  totals,
  windowTotals,
} from './usage';
import { refreshUsageView, showUsageView } from './usageView';

const HOUR = 3_600_000;

let usageBar: vscode.StatusBarItem | undefined;

export function activate(context: vscode.ExtensionContext): void {
  initUsage(context, () => {
    updateUsageBar();
    refreshUsageView();
  });
  initChatImport(context);

  usageBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
  usageBar.command = 'aiBilling.showUsage';
  context.subscriptions.push(usageBar);

  context.subscriptions.push(
    vscode.commands.registerCommand('aiBilling.showUsage', async () => {
      await syncChatUsage();
      showUsageView(context);
    }),
    vscode.commands.registerCommand('aiBilling.syncChatUsage', async () => {
      await syncChatUsage();
      updateUsageBar();
      refreshUsageView();
      await vscode.window.showInformationMessage('AI Billing: VS Code Chat usage synchronised.');
    }),
    vscode.commands.registerCommand('aiBilling.showDiagnosticsOutput', async () => {
      showChatImportDiagnosticsOutput();
      await vscode.window.showInformationMessage('AI Billing diagnostics output opened.');
    }),
    vscode.commands.registerCommand('aiBilling.importDebugViewFromClipboard', async () => {
      const raw = await vscode.env.clipboard.readText();
      if (!raw.trim()) {
        await vscode.window.showWarningMessage('AI Billing: clipboard is empty. Copy the Debug View block first.');
        return;
      }

      const result = await importDebugViewText(raw);
      updateUsageBar();
      refreshUsageView();
      await vscode.window.showInformationMessage(
        `AI Billing: imported ${result.imported} debug usage record(s), skipped ${result.skipped}.`,
      );
    }),
    vscode.commands.registerCommand('aiBilling.clearUsage', async () => {
      await clearUsage();
      updateUsageBar();
      refreshUsageView();
      await vscode.window.showInformationMessage('AI Billing local records cleared. Copilot debug/transcript history was not modified.');
    }),
    vscode.commands.registerCommand('aiBilling.rebuildUsage', async () => {
      await clearUsage();
      await clearChatImportState();
      await syncChatUsage();
      updateUsageBar();
      refreshUsageView();
      await vscode.window.showInformationMessage('AI Billing rebuilt from available Copilot history.');
    }),
    vscode.commands.registerCommand('aiBilling.recordUsage', async (args: unknown) => {
      const payload = normaliseRecordArgs(args);
      if (!payload) {
        await vscode.window.showErrorMessage('AI Billing: invalid usage payload.');
        return;
      }

      await recordUsage(payload);
      updateUsageBar();
      refreshUsageView();
    }),
  );

  updateUsageBar();
}

export function deactivate(): void {
  disposeChatImport();
  usageBar?.dispose();
}

function updateUsageBar(): void {
  if (!usageBar) {
    return;
  }

    const periodRange = currentBillingPeriodRange();
    const t = billingPeriodTotals();
    const allTime = totals();
  const last7d = windowTotals(7 * 24 * HOUR);
  usageBar.text = `AI Billing $${t.costForecast.toFixed(2)} (cycle) / $${allTime.costForecast.toFixed(2)} (overall)`;
    const periodStart = new Date(periodRange.start).toLocaleDateString();
    const periodEnd = new Date(periodRange.endExclusive - 1).toLocaleDateString();
  usageBar.tooltip = [
      `Current billing cycle (${periodStart} - ${periodEnd}): $${t.costForecast.toFixed(4)} · ${t.calls} calls · ${t.input + t.output} tokens · ${t.requestUnits.toFixed(2)} credits`,
    `Last 7 days: $${last7d.costForecast.toFixed(4)} (forecast)`,
      `All time: $${allTime.costForecast.toFixed(4)} (forecast)`,
    `Credits prefer Copilot-reported usage units when available.`,
  ].join('\n');
  usageBar.show();
}

function normaliseRecordArgs(args: unknown):
  | {
      model: string;
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
      };
      explicitCostUsd?: number;
      provider?: 'claude' | 'copilot' | 'ollama' | 'unknown';
      requestUnits?: number;
      ts?: number;
    }
  | undefined {
  if (!args || typeof args !== 'object') {
    return undefined;
  }

  const payload = args as Record<string, unknown>;
  const model = typeof payload.model === 'string' ? payload.model : undefined;
  if (!model) {
    return undefined;
  }

  const provider =
    payload.provider === 'claude' || payload.provider === 'copilot' || payload.provider === 'ollama' || payload.provider === 'unknown'
      ? (payload.provider as 'claude' | 'copilot' | 'ollama' | 'unknown')
      : undefined;

  return {
    model,
    usage: typeof payload.usage === 'object' && payload.usage ? (payload.usage as never) : undefined,
    explicitCostUsd: typeof payload.explicitCostUsd === 'number' ? payload.explicitCostUsd : undefined,
    provider,
    requestUnits: typeof payload.requestUnits === 'number' ? payload.requestUnits : undefined,
    ts: typeof payload.ts === 'number' ? payload.ts : undefined,
  };
}