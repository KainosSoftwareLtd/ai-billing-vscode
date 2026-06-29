"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const chatImport_1 = require("./chatImport");
const usage_1 = require("./usage");
const usageView_1 = require("./usageView");
const HOUR = 3_600_000;
let usageBar;
function activate(context) {
    (0, usage_1.initUsage)(context, () => {
        updateUsageBar();
        (0, usageView_1.refreshUsageView)();
    });
    (0, chatImport_1.initChatImport)(context);
    usageBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
    usageBar.command = 'aiBilling.showUsage';
    context.subscriptions.push(usageBar);
    context.subscriptions.push(vscode.commands.registerCommand('aiBilling.showUsage', async () => {
        await (0, chatImport_1.syncChatUsage)();
        (0, usageView_1.showUsageView)(context);
    }), vscode.commands.registerCommand('aiBilling.syncChatUsage', async () => {
        await (0, chatImport_1.syncChatUsage)();
        updateUsageBar();
        (0, usageView_1.refreshUsageView)();
        await vscode.window.showInformationMessage('AI Billing: VS Code Chat usage synchronised.');
    }), vscode.commands.registerCommand('aiBilling.showDiagnosticsOutput', async () => {
        (0, chatImport_1.showChatImportDiagnosticsOutput)();
        await vscode.window.showInformationMessage('AI Billing diagnostics output opened.');
    }), vscode.commands.registerCommand('aiBilling.importDebugViewFromClipboard', async () => {
        const raw = await vscode.env.clipboard.readText();
        if (!raw.trim()) {
            await vscode.window.showWarningMessage('AI Billing: clipboard is empty. Copy the Debug View block first.');
            return;
        }
        const result = await (0, chatImport_1.importDebugViewText)(raw);
        updateUsageBar();
        (0, usageView_1.refreshUsageView)();
        await vscode.window.showInformationMessage(`AI Billing: imported ${result.imported} debug usage record(s), skipped ${result.skipped}.`);
    }), vscode.commands.registerCommand('aiBilling.clearUsage', async () => {
        await (0, usage_1.clearUsage)();
        updateUsageBar();
        (0, usageView_1.refreshUsageView)();
        await vscode.window.showInformationMessage('AI Billing local records cleared. Copilot debug/transcript history was not modified.');
    }), vscode.commands.registerCommand('aiBilling.rebuildUsage', async () => {
        await (0, usage_1.clearUsage)();
        await (0, chatImport_1.clearChatImportState)();
        await (0, chatImport_1.syncChatUsage)();
        updateUsageBar();
        (0, usageView_1.refreshUsageView)();
        await vscode.window.showInformationMessage('AI Billing rebuilt from available Copilot history.');
    }), vscode.commands.registerCommand('aiBilling.recordUsage', async (args) => {
        const payload = normaliseRecordArgs(args);
        if (!payload) {
            await vscode.window.showErrorMessage('AI Billing: invalid usage payload.');
            return;
        }
        await (0, usage_1.recordUsage)(payload);
        updateUsageBar();
        (0, usageView_1.refreshUsageView)();
    }));
    updateUsageBar();
}
function deactivate() {
    (0, chatImport_1.disposeChatImport)();
    usageBar?.dispose();
}
function updateUsageBar() {
    if (!usageBar) {
        return;
    }
    const periodRange = (0, usage_1.currentBillingPeriodRange)();
    const t = (0, usage_1.billingPeriodTotals)();
    const allTime = (0, usage_1.totals)();
    const last7d = (0, usage_1.windowTotals)(7 * 24 * HOUR);
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
function normaliseRecordArgs(args) {
    if (!args || typeof args !== 'object') {
        return undefined;
    }
    const payload = args;
    const model = typeof payload.model === 'string' ? payload.model : undefined;
    if (!model) {
        return undefined;
    }
    const provider = payload.provider === 'claude' || payload.provider === 'copilot' || payload.provider === 'ollama' || payload.provider === 'unknown'
        ? payload.provider
        : undefined;
    return {
        model,
        usage: typeof payload.usage === 'object' && payload.usage ? payload.usage : undefined,
        explicitCostUsd: typeof payload.explicitCostUsd === 'number' ? payload.explicitCostUsd : undefined,
        provider,
        requestUnits: typeof payload.requestUnits === 'number' ? payload.requestUnits : undefined,
        ts: typeof payload.ts === 'number' ? payload.ts : undefined,
    };
}
//# sourceMappingURL=extension.js.map