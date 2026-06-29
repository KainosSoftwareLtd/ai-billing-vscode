import * as vscode from 'vscode';

function getNumber(key: string, fallback: number): number {
  const raw = vscode.workspace.getConfiguration('aiBilling').get<unknown>(key, fallback);
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function includedCredits(): number {
  return getNumber('copilot.billing.monthlyIncludedRequests', 0);
}

function creditPriceUsd(): number {
  return getNumber('copilot.billing.overageUsdPerRequest', 0.01);
}

function diagnosticsEnabled(): boolean {
  return vscode.workspace.getConfiguration('aiBilling').get<boolean>('diagnostics.enabled', false) === true;
}

function billingPeriodStartDay(): number {
  const raw = vscode.workspace.getConfiguration('aiBilling').get<unknown>('billing.periodStartDay', 1);
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.min(28, Math.max(1, Math.trunc(value)));
}

function billingLicenseStart(): string | undefined {
  const raw = vscode.workspace.getConfiguration('aiBilling').get<unknown>('billing.licenseStart', '');
  if (typeof raw !== 'string') {
    return undefined;
  }

  const value = raw.trim();
  return value || undefined;
}

export const Config = {
  includedCredits,
  creditPriceUsd,
  diagnosticsEnabled,
  billingPeriodStartDay,
  billingLicenseStart,
  copilotMonthlyIncludedRequests: includedCredits,
  copilotOverageUsdPerRequest: creditPriceUsd,

  copilotRequestUnitWeights(): Record<string, number> {
    const raw = vscode.workspace.getConfiguration('aiBilling').get<Record<string, unknown>>(
      'copilot.billing.requestUnitWeights',
      { '*': 1 },
    );

    const weights: Record<string, number> = {};
    for (const [key, value] of Object.entries(raw ?? { '*': 1 })) {
      const numeric = Number(value);
      if (Number.isFinite(numeric) && numeric >= 0) {
        weights[key] = numeric;
      }
    }

    if (!Object.keys(weights).length) {
      weights['*'] = 1;
    }

    return weights;
  },
};
