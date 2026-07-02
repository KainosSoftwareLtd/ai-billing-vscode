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
exports.Config = void 0;
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const vscode = __importStar(require("vscode"));
function getNumber(key, fallback) {
    const raw = vscode.workspace.getConfiguration('aiBilling').get(key, fallback);
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : fallback;
}
function includedCredits() {
    return getNumber('copilot.billing.monthlyIncludedRequests', 0);
}
function creditPriceUsd() {
    return getNumber('copilot.billing.overageUsdPerRequest', 0.01);
}
function diagnosticsEnabled() {
    return vscode.workspace.getConfiguration('aiBilling').get('diagnostics.enabled', false) === true;
}
function billingPeriodStartDay() {
    const raw = vscode.workspace.getConfiguration('aiBilling').get('billing.periodStartDay', 1);
    const value = Number(raw);
    if (!Number.isFinite(value)) {
        return 1;
    }
    return Math.min(28, Math.max(1, Math.trunc(value)));
}
function billingLicenseStart() {
    const raw = vscode.workspace.getConfiguration('aiBilling').get('billing.licenseStart', '');
    if (typeof raw !== 'string') {
        return undefined;
    }
    const value = raw.trim();
    return value || undefined;
}
function defaultVscodeDataPath() {
    if (process.platform === 'darwin') {
        return path.join(os.homedir(), 'Library', 'Application Support', 'Code');
    }
    if (process.platform === 'win32') {
        return path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'Code');
    }
    return path.join(os.homedir(), '.config', 'Code');
}
function normaliseConfiguredVscodeDataPath(value) {
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
function vscodeDataPath() {
    const raw = vscode.workspace.getConfiguration('aiBilling').get('vscodeDataPath', '');
    if (typeof raw !== 'string') {
        return defaultVscodeDataPath();
    }
    const value = raw.trim();
    return value ? normaliseConfiguredVscodeDataPath(value) : defaultVscodeDataPath();
}
function vscodeDataPaths() {
    const rawAdditional = vscode.workspace.getConfiguration('aiBilling').get('additionalVscodeDataPaths', []);
    const additional = Array.isArray(rawAdditional)
        ? rawAdditional.filter((value) => typeof value === 'string')
        : [];
    const paths = [vscodeDataPath(), ...additional]
        .map((value) => value.trim())
        .filter(Boolean)
        .map(normaliseConfiguredVscodeDataPath);
    return Array.from(new Set(paths));
}
exports.Config = {
    includedCredits,
    creditPriceUsd,
    diagnosticsEnabled,
    billingPeriodStartDay,
    billingLicenseStart,
    vscodeDataPath,
    vscodeDataPaths,
    copilotMonthlyIncludedRequests: includedCredits,
    copilotOverageUsdPerRequest: creditPriceUsd,
    copilotRequestUnitWeights() {
        const raw = vscode.workspace.getConfiguration('aiBilling').get('copilot.billing.requestUnitWeights', { '*': 1 });
        const weights = {};
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
//# sourceMappingURL=config.js.map