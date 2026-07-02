import * as os from 'node:os';
import * as path from 'node:path';
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

function defaultVscodeDataPath(): string {
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Code');
  }
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'Code');
  }
  return path.join(os.homedir(), '.config', 'Code');
}

function normaliseConfiguredVscodeDataPath(value: string): string {
  if (process.platform !== 'linux') {
    return value;
  }

  // For WSL accept the Windows path and convert it to the Linux mount point path.
  // This is useful for users who have their VS Code data on a Windows drive and want to use it from WSL.
  const windowsDrivePath = /^([a-zA-Z]):[\\/](.*)$/.exec(value);
  if (!windowsDrivePath) {
    return value;
  }

  const [, drive, rest] = windowsDrivePath;
  return path.join('/mnt', drive.toLowerCase(), rest.replace(/[\\/]+/g, path.sep));
}

function vscodeDataPath(): string {
  const raw = vscode.workspace.getConfiguration('aiBilling').get<unknown>('vscodeDataPath', '');
  if (typeof raw !== 'string') {
    return defaultVscodeDataPath();
  }

  const value = raw.trim();
  return value ? normaliseConfiguredVscodeDataPath(value) : defaultVscodeDataPath();
}

function vscodeDataPaths(): string[] {
  const rawAdditional = vscode.workspace.getConfiguration('aiBilling').get<unknown>('additionalVscodeDataPaths', []);
  const additional = Array.isArray(rawAdditional)
    ? rawAdditional.filter((value): value is string => typeof value === 'string')
    : [];

  const paths = [vscodeDataPath(), ...additional]
    .map((value) => value.trim())
    .filter(Boolean)
    .map(normaliseConfiguredVscodeDataPath);

  return Array.from(new Set(paths));
}

export const Config = {
  includedCredits,
  creditPriceUsd,
  diagnosticsEnabled,
  billingPeriodStartDay,
  billingLicenseStart,
  vscodeDataPath,
  vscodeDataPaths,
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
