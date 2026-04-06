import { readFile, writeFile } from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';

export type CompressionMode = 'range' | 'message';
export type CompressionPermission = 'ask' | 'allow' | 'deny';
export type PruneNotification = 'off' | 'minimal' | 'detailed';
export type PruneNotificationType = 'chat' | 'toast';
export type NumericOrPercent = number | `${number}%`;

export interface DcpConfig {
	enabled: boolean;
	debug: boolean;
	pruneNotification: PruneNotification;
	pruneNotificationType: PruneNotificationType;
	commands: {
		enabled: boolean;
		protectedTools: string[];
	};
	manualMode: {
		enabled: boolean;
		automaticStrategies: boolean;
	};
	turnProtection: {
		enabled: boolean;
		turns: number;
	};
	experimental: {
		allowSubAgents: boolean;
		customPrompts: boolean;
	};
	protectedFilePatterns: string[];
	compress: {
		mode: CompressionMode;
		permission: CompressionPermission;
		showCompression: boolean;
		summaryBuffer: boolean;
		maxContextLimit: NumericOrPercent;
		minContextLimit: NumericOrPercent;
		modelMaxLimits?: Record<string, NumericOrPercent>;
		modelMinLimits?: Record<string, NumericOrPercent>;
		nudgeFrequency: number;
		iterationNudgeThreshold: number;
		nudgeForce: 'strong' | 'soft';
		protectedTools: string[];
		protectUserMessages: boolean;
	};
	strategies: {
		deduplication: {
			enabled: boolean;
			protectedTools: string[];
		};
		purgeErrors: {
			enabled: boolean;
			turns: number;
			protectedTools: string[];
		};
	};
}

export interface PruningSettingsFormState {
	enabled: boolean;
	debug: boolean;
	deduplication: {
		enabled: boolean;
		protectedTools: string[];
	};
	purgeErrors: {
		enabled: boolean;
		turns: number;
		protectedTools: string[];
	};
	compress: {
		mode: CompressionMode;
		permission: CompressionPermission;
		showCompression: boolean;
		nudgeFrequency: number;
	};
	protectedFilePatterns: string[];
}

interface ConfigDocument extends Record<string, unknown> {
	dcp?: unknown;
}

const DEFAULT_DCP_CONFIG: DcpConfig = {
	enabled: true,
	debug: false,
	pruneNotification: 'off',
	pruneNotificationType: 'chat',
	commands: {
		enabled: true,
		protectedTools: []
	},
	manualMode: {
		enabled: true,
		automaticStrategies: true
	},
	turnProtection: {
		enabled: false,
		turns: 0
	},
	experimental: {
		allowSubAgents: true,
		customPrompts: true
	},
	protectedFilePatterns: [],
	compress: {
		mode: 'message',
		permission: 'allow',
		showCompression: false,
		summaryBuffer: false,
		maxContextLimit: 10,
		minContextLimit: 0,
		nudgeFrequency: 1,
		iterationNudgeThreshold: 1,
		nudgeForce: 'soft',
		protectedTools: [],
		protectUserMessages: false
	},
	strategies: {
		deduplication: {
			enabled: true,
			protectedTools: []
		},
		purgeErrors: {
			enabled: true,
			turns: 1,
			protectedTools: []
		}
	}
};

export const PRUNING_SETTINGS_VIEW_TYPE = 'contexty.pruning.settings';

function getWorkspaceRoot(): string | undefined {
	return vscode.workspace.workspaceFolders?.find((folder) => folder.uri.scheme === 'file')?.uri.fsPath;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toBoolean(value: unknown, fallback: boolean): boolean {
	return typeof value === 'boolean' ? value : fallback;
}

function toNumber(value: unknown, fallback: number): number {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return value;
	}
	if (typeof value === 'string' && value.trim().length > 0) {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) {
			return parsed;
		}
	}
	return fallback;
}

function toStringArray(value: unknown, fallback: string[]): string[] {
	if (Array.isArray(value)) {
		return value
			.map((item) => (typeof item === 'string' ? item.trim() : ''))
			.filter((item) => item.length > 0);
	}

	if (typeof value === 'string') {
		return value
			.split(/\r?\n|,/)
			.map((item) => item.trim())
			.filter((item) => item.length > 0);
	}

	return [...fallback];
}

function toEnum<T extends readonly string[]>(value: unknown, allowed: T, fallback: T[number]): T[number] {
	return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T[number]) : fallback;
}

function toNumericOrPercent(value: unknown, fallback: NumericOrPercent): NumericOrPercent {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return value;
	}
	if (typeof value === 'string' && /^\d+(?:\.\d+)?%$/u.test(value)) {
		return value as `${number}%`;
	}
	return fallback;
}

function toNumericLimitMap(value: unknown): Record<string, NumericOrPercent> | undefined {
	if (!isRecord(value)) {
		return undefined;
	}

	const entries = Object.entries(value)
		.map(([key, entry]) => [key, toNumericOrPercent(entry, 0)] as const)
		.filter(([, entry]) => typeof entry === 'number' || typeof entry === 'string');

	return entries.length > 0 ? Object.fromEntries(entries) as Record<string, NumericOrPercent> : undefined;
}

function normalizeDcpConfig(value: unknown): DcpConfig {
	const source = isRecord(value) ? value : {};
	const commands = isRecord(source.commands) ? source.commands : {};
	const manualMode = isRecord(source.manualMode) ? source.manualMode : {};
	const turnProtection = isRecord(source.turnProtection) ? source.turnProtection : {};
	const experimental = isRecord(source.experimental) ? source.experimental : {};
	const compress = isRecord(source.compress) ? source.compress : {};
	const strategies = isRecord(source.strategies) ? source.strategies : {};
	const deduplication = isRecord(strategies.deduplication) ? strategies.deduplication : {};
	const purgeErrors = isRecord(strategies.purgeErrors) ? strategies.purgeErrors : {};

	return {
		enabled: toBoolean(source.enabled, DEFAULT_DCP_CONFIG.enabled),
		debug: toBoolean(source.debug, DEFAULT_DCP_CONFIG.debug),
		pruneNotification: toEnum(source.pruneNotification, ['off', 'minimal', 'detailed'] as const, DEFAULT_DCP_CONFIG.pruneNotification),
		pruneNotificationType: toEnum(source.pruneNotificationType, ['chat', 'toast'] as const, DEFAULT_DCP_CONFIG.pruneNotificationType),
		commands: {
			enabled: toBoolean(commands.enabled, DEFAULT_DCP_CONFIG.commands.enabled),
			protectedTools: toStringArray(commands.protectedTools, DEFAULT_DCP_CONFIG.commands.protectedTools)
		},
		manualMode: {
			enabled: toBoolean(manualMode.enabled, DEFAULT_DCP_CONFIG.manualMode.enabled),
			automaticStrategies: toBoolean(manualMode.automaticStrategies, DEFAULT_DCP_CONFIG.manualMode.automaticStrategies)
		},
		turnProtection: {
			enabled: toBoolean(turnProtection.enabled, DEFAULT_DCP_CONFIG.turnProtection.enabled),
			turns: toNumber(turnProtection.turns, DEFAULT_DCP_CONFIG.turnProtection.turns)
		},
		experimental: {
			allowSubAgents: toBoolean(experimental.allowSubAgents, DEFAULT_DCP_CONFIG.experimental.allowSubAgents),
			customPrompts: toBoolean(experimental.customPrompts, DEFAULT_DCP_CONFIG.experimental.customPrompts)
		},
		protectedFilePatterns: toStringArray(source.protectedFilePatterns, DEFAULT_DCP_CONFIG.protectedFilePatterns),
		compress: {
			mode: toEnum(compress.mode, ['range', 'message'] as const, DEFAULT_DCP_CONFIG.compress.mode),
			permission: toEnum(compress.permission, ['ask', 'allow', 'deny'] as const, DEFAULT_DCP_CONFIG.compress.permission),
			showCompression: toBoolean(compress.showCompression, DEFAULT_DCP_CONFIG.compress.showCompression),
			summaryBuffer: toBoolean(compress.summaryBuffer, DEFAULT_DCP_CONFIG.compress.summaryBuffer),
			maxContextLimit: toNumericOrPercent(compress.maxContextLimit, DEFAULT_DCP_CONFIG.compress.maxContextLimit),
			minContextLimit: toNumericOrPercent(compress.minContextLimit, DEFAULT_DCP_CONFIG.compress.minContextLimit),
			modelMaxLimits: toNumericLimitMap(compress.modelMaxLimits),
			modelMinLimits: toNumericLimitMap(compress.modelMinLimits),
			nudgeFrequency: toNumber(compress.nudgeFrequency, DEFAULT_DCP_CONFIG.compress.nudgeFrequency),
			iterationNudgeThreshold: toNumber(compress.iterationNudgeThreshold, DEFAULT_DCP_CONFIG.compress.iterationNudgeThreshold),
			nudgeForce: toEnum(compress.nudgeForce, ['strong', 'soft'] as const, DEFAULT_DCP_CONFIG.compress.nudgeForce),
			protectedTools: toStringArray(compress.protectedTools, DEFAULT_DCP_CONFIG.compress.protectedTools),
			protectUserMessages: toBoolean(compress.protectUserMessages, DEFAULT_DCP_CONFIG.compress.protectUserMessages)
		},
		strategies: {
			deduplication: {
				enabled: toBoolean(deduplication.enabled, DEFAULT_DCP_CONFIG.strategies.deduplication.enabled),
				protectedTools: toStringArray(deduplication.protectedTools, DEFAULT_DCP_CONFIG.strategies.deduplication.protectedTools)
			},
			purgeErrors: {
				enabled: toBoolean(purgeErrors.enabled, DEFAULT_DCP_CONFIG.strategies.purgeErrors.enabled),
				turns: toNumber(purgeErrors.turns, DEFAULT_DCP_CONFIG.strategies.purgeErrors.turns),
				protectedTools: toStringArray(purgeErrors.protectedTools, DEFAULT_DCP_CONFIG.strategies.purgeErrors.protectedTools)
			}
		}
	};
}

function toFormState(config: DcpConfig): PruningSettingsFormState {
	return {
		enabled: config.enabled,
		debug: config.debug,
		deduplication: {
			enabled: config.strategies.deduplication.enabled,
			protectedTools: [...config.strategies.deduplication.protectedTools]
		},
		purgeErrors: {
			enabled: config.strategies.purgeErrors.enabled,
			turns: config.strategies.purgeErrors.turns,
			protectedTools: [...config.strategies.purgeErrors.protectedTools]
		},
		compress: {
			mode: config.compress.mode,
			permission: config.compress.permission,
			showCompression: config.compress.showCompression,
			nudgeFrequency: config.compress.nudgeFrequency
		},
		protectedFilePatterns: [...config.protectedFilePatterns]
	};
}

function applyFormState(baseConfig: DcpConfig, formState: PruningSettingsFormState): DcpConfig {
	return {
		...baseConfig,
		enabled: formState.enabled,
		debug: formState.debug,
		protectedFilePatterns: [...formState.protectedFilePatterns],
		compress: {
			...baseConfig.compress,
			mode: formState.compress.mode,
			permission: formState.compress.permission,
			showCompression: formState.compress.showCompression,
			nudgeFrequency: formState.compress.nudgeFrequency,
			protectedTools: [...baseConfig.compress.protectedTools]
		},
		strategies: {
			...baseConfig.strategies,
			deduplication: {
				...baseConfig.strategies.deduplication,
				enabled: formState.deduplication.enabled,
				protectedTools: [...formState.deduplication.protectedTools]
			},
			purgeErrors: {
				...baseConfig.strategies.purgeErrors,
				enabled: formState.purgeErrors.enabled,
				turns: formState.purgeErrors.turns,
				protectedTools: [...formState.purgeErrors.protectedTools]
			}
		}
	};
}

function parseJson(value: string): ConfigDocument {
	const parsed = JSON.parse(value) as unknown;
	return isRecord(parsed) ? parsed : {};
}

async function readConfigDocument(workspaceRoot: string): Promise<ConfigDocument> {
	const configPath = path.join(workspaceRoot, 'contexty.config.json');

	try {
		const raw = await readFile(configPath, 'utf8');
		return parseJson(raw);
	} catch {
		return {};
	}
}

async function writeConfigDocument(workspaceRoot: string, document: ConfigDocument): Promise<void> {
	const configPath = path.join(workspaceRoot, 'contexty.config.json');
	await writeFile(configPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
}

function toDisplayValue(value: string[] | undefined): string {
	return (value ?? []).join('\n');
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function toSerializedJson(value: unknown): string {
	return JSON.stringify(value).replace(/</g, '\\u003c');
}

function getNonce(): string {
	const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let nonce = '';
	for (let index = 0; index < 32; index += 1) {
		nonce += characters[Math.floor(Math.random() * characters.length)];
	}
	return nonce;
}

function renderToggle(id: string, label: string, checked: boolean, help: string): string {
	return `
		<label class="toggle-row" for="${id}">
			<input id="${id}" type="checkbox" ${checked ? 'checked' : ''} />
			<span>
				<span class="toggle-label">${escapeHtml(label)}</span>
				<span class="toggle-help">${escapeHtml(help)}</span>
			</span>
		</label>
	`;
}

export async function loadPruningSettings(workspaceRoot: string): Promise<PruningSettingsFormState> {
	const document = await readConfigDocument(workspaceRoot);
	return toFormState(normalizeDcpConfig(document.dcp));
}

export async function savePruningSettings(workspaceRoot: string, formState: PruningSettingsFormState): Promise<PruningSettingsFormState> {
	const document = await readConfigDocument(workspaceRoot);
	const nextConfig = applyFormState(normalizeDcpConfig(document.dcp), formState);
	document.dcp = nextConfig;
	await writeConfigDocument(workspaceRoot, document);
	return toFormState(nextConfig);
}

export function renderPruningSettingsWebview(webview: vscode.Webview, formState: PruningSettingsFormState): string {
	const nonce = getNonce();
	const initialState = toSerializedJson(formState);

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Contexty DCP Settings</title>
	<style>
		:root {
			color-scheme: light dark;
			--panel-bg: color-mix(in srgb, var(--vscode-sideBar-background) 82%, var(--vscode-editor-background) 18%);
			--card-bg: color-mix(in srgb, var(--vscode-editor-background) 88%, var(--vscode-sideBar-background) 12%);
			--card-border: color-mix(in srgb, var(--vscode-foreground) 13%, transparent);
			--soft-border: color-mix(in srgb, var(--vscode-foreground) 8%, transparent);
			--muted: color-mix(in srgb, var(--vscode-foreground) 62%, transparent);
			--accent: var(--vscode-button-background);
			--accent-text: var(--vscode-button-foreground);
			--danger: color-mix(in srgb, var(--vscode-errorForeground) 85%, transparent);
		}
		* { box-sizing: border-box; }
		html, body {
			margin: 0;
			padding: 0;
			background: var(--panel-bg);
			color: var(--vscode-foreground);
			font-family: var(--vscode-font-family, sans-serif);
		}
		body {
			padding: 16px;
		}
		main {
			max-width: 1080px;
			margin: 0 auto;
			display: grid;
			gap: 16px;
		}
		.header {
			display: grid;
			gap: 6px;
			padding: 18px 20px;
			border: 1px solid var(--card-border);
			border-radius: 12px;
			background: linear-gradient(180deg, color-mix(in srgb, var(--card-bg) 92%, transparent), var(--card-bg));
			box-shadow: 0 16px 40px color-mix(in srgb, var(--vscode-editor-background) 28%, transparent);
		}
		.kicker {
			color: var(--muted);
			font-size: 11px;
			font-weight: 600;
			letter-spacing: 0.14em;
			text-transform: uppercase;
		}
		h1 {
			margin: 0;
			font-size: 24px;
			line-height: 1.1;
		}
		.description {
			margin: 0;
			max-width: 72ch;
			color: var(--muted);
			font-size: 13px;
			line-height: 1.5;
		}
		form {
			display: grid;
			gap: 16px;
		}
		.grid {
			display: grid;
			grid-template-columns: repeat(2, minmax(0, 1fr));
			gap: 16px;
		}
		.card {
			padding: 16px;
			border: 1px solid var(--card-border);
			border-radius: 12px;
			background: var(--card-bg);
		}
		.card.full {
			grid-column: 1 / -1;
		}
		.card h2 {
			margin: 0 0 10px;
			font-size: 14px;
			line-height: 1.3;
		}
		.section-copy {
			margin: -2px 0 12px;
			color: var(--muted);
			font-size: 12px;
			line-height: 1.45;
		}
		.stack {
			display: grid;
			gap: 10px;
		}
		.toggle-row {
			display: grid;
			grid-template-columns: 18px minmax(0, 1fr);
			gap: 12px;
			align-items: start;
			padding: 10px 0;
			cursor: pointer;
		}
		.toggle-row + .toggle-row {
			border-top: 1px solid var(--soft-border);
		}
		.toggle-row input {
			margin-top: 3px;
		}
		.toggle-label {
			display: block;
			font-weight: 600;
		}
		.toggle-help {
			display: block;
			margin-top: 2px;
			color: var(--muted);
			font-size: 12px;
			line-height: 1.4;
		}
		.field {
			display: grid;
			gap: 6px;
		}
		.field label {
			font-size: 12px;
			font-weight: 600;
		}
		input[type="number"],
		select,
		textarea {
			width: 100%;
			border: 1px solid var(--soft-border);
			border-radius: 8px;
			background: color-mix(in srgb, var(--vscode-input-background) 92%, transparent);
			color: var(--vscode-input-foreground);
			font: inherit;
		}
		input[type="number"],
		select {
			height: 34px;
			padding: 0 10px;
		}
		textarea {
			min-height: 96px;
			padding: 10px;
			resize: vertical;
			line-height: 1.5;
		}
		textarea::placeholder {
			color: var(--muted);
		}
		.help {
			color: var(--muted);
			font-size: 11px;
			line-height: 1.4;
		}
		.footer {
			display: flex;
			justify-content: space-between;
			align-items: center;
			gap: 12px;
			padding: 14px 16px;
			border: 1px solid var(--card-border);
			border-radius: 12px;
			background: var(--card-bg);
		}
		.status {
			min-height: 1.25em;
			color: var(--muted);
			font-size: 12px;
		}
		.actions {
			display: flex;
			gap: 8px;
		}
		button {
			border: 1px solid transparent;
			border-radius: 8px;
			padding: 0 14px;
			height: 34px;
			font: inherit;
			cursor: pointer;
		}
		button.primary {
			background: var(--accent);
			color: var(--accent-text);
		}
		button.secondary {
			background: transparent;
			color: var(--vscode-foreground);
			border-color: var(--soft-border);
		}
		@media (max-width: 820px) {
			.grid { grid-template-columns: 1fr; }
			.footer { flex-direction: column; align-items: stretch; }
			.actions { justify-content: stretch; }
			.actions button { flex: 1; }
		}
	</style>
</head>
<body>
	<main>
		<header class="header">
			<div class="kicker">Contexty / DCP</div>
			<h1>Pruning settings</h1>
			<p class="description">Tune DCP behavior directly in <code>contexty.config.json</code>. This panel keeps the rest of the file intact and only updates the DCP section you edit here.</p>
		</header>

		<form id="settings-form">
			<div class="grid">
				<section class="card">
					<h2>Core</h2>
					<div class="stack">
						${renderToggle('enabled', 'Enable DCP', formState.enabled, 'Turns pruning behavior on or off for the workspace.')}
						${renderToggle('debug', 'Debug mode', formState.debug, 'Writes additional debug information for pruning operations.')}
					</div>
				</section>

				<section class="card">
					<h2>Compression</h2>
					<p class="section-copy">Choose how compression is triggered and how often nudges appear.</p>
					<div class="stack">
						<div class="field">
							<label for="compressMode">Mode</label>
							<select id="compressMode">
								<option value="range" ${formState.compress.mode === 'range' ? 'selected' : ''}>Range</option>
								<option value="message" ${formState.compress.mode === 'message' ? 'selected' : ''}>Message</option>
							</select>
						</div>
						<div class="field">
							<label for="compressPermission">Permission</label>
							<select id="compressPermission">
								<option value="ask" ${formState.compress.permission === 'ask' ? 'selected' : ''}>Ask</option>
								<option value="allow" ${formState.compress.permission === 'allow' ? 'selected' : ''}>Allow</option>
								<option value="deny" ${formState.compress.permission === 'deny' ? 'selected' : ''}>Deny</option>
							</select>
						</div>
						${renderToggle('showCompression', 'Show compression', formState.compress.showCompression, 'Surface compression activity in the UI.')}
						<div class="field">
							<label for="nudgeFrequency">Nudge frequency</label>
							<input id="nudgeFrequency" type="number" min="0" step="1" value="${escapeHtml(String(formState.compress.nudgeFrequency))}" />
							<div class="help">How often DCP should suggest compression nudges.</div>
						</div>
					</div>
				</section>

				<section class="card">
					<h2>Deduplication</h2>
					<p class="section-copy">Control duplicate-tool filtering and protect tools that should always pass through.</p>
					<div class="stack">
						${renderToggle('dedupEnabled', 'Enable deduplication', formState.deduplication.enabled, 'Removes repeated tool usage when DCP compacts context.')}
						<div class="field">
							<label for="dedupProtectedTools">Protected tools</label>
							<textarea id="dedupProtectedTools" placeholder="One tool per line">${escapeHtml(toDisplayValue(formState.deduplication.protectedTools))}</textarea>
							<div class="help">Tools in this list are never deduplicated.</div>
						</div>
					</div>
				</section>

				<section class="card">
					<h2>Purge Errors</h2>
					<p class="section-copy">Keep error-heavy turns from accumulating and protect sensitive tools from pruning.</p>
					<div class="stack">
						${renderToggle('purgeEnabled', 'Enable purge errors', formState.purgeErrors.enabled, 'Allows DCP to purge repeated error paths.')}
						<div class="field">
							<label for="purgeTurns">Turns</label>
							<input id="purgeTurns" type="number" min="0" step="1" value="${escapeHtml(String(formState.purgeErrors.turns))}" />
							<div class="help">How many turns of errors to tolerate before purging.</div>
						</div>
						<div class="field">
							<label for="purgeProtectedTools">Protected tools</label>
							<textarea id="purgeProtectedTools" placeholder="One tool per line">${escapeHtml(toDisplayValue(formState.purgeErrors.protectedTools))}</textarea>
							<div class="help">These tools remain visible even if purge errors runs.</div>
						</div>
					</div>
				</section>

				<section class="card full">
					<h2>Protected file patterns</h2>
					<p class="section-copy">Patterns here stay out of DCP pruning. Use one pattern per line or separate with commas.</p>
					<div class="field">
						<label for="protectedFilePatterns">Patterns</label>
						<textarea id="protectedFilePatterns" placeholder="**/README.md\n**/docs/**">${escapeHtml(toDisplayValue(formState.protectedFilePatterns))}</textarea>
						<div class="help">Examples: <code>**/README.md</code>, <code>src/generated/**</code>.</div>
					</div>
				</section>
			</div>

			<footer class="footer">
				<div class="status" id="status">Ready</div>
				<div class="actions">
					<button class="secondary" type="button" id="reload">Reload from disk</button>
					<button class="primary" type="submit" id="save">Save changes</button>
				</div>
			</footer>
		</form>
	</main>

	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		const initialState = ${initialState};
		const status = document.getElementById('status');
		const saveButton = document.getElementById('save');
		const reloadButton = document.getElementById('reload');
		const fields = {
			enabled: document.getElementById('enabled'),
			debug: document.getElementById('debug'),
			dedupEnabled: document.getElementById('dedupEnabled'),
			dedupProtectedTools: document.getElementById('dedupProtectedTools'),
			purgeEnabled: document.getElementById('purgeEnabled'),
			purgeTurns: document.getElementById('purgeTurns'),
			purgeProtectedTools: document.getElementById('purgeProtectedTools'),
			compressMode: document.getElementById('compressMode'),
			compressPermission: document.getElementById('compressPermission'),
			showCompression: document.getElementById('showCompression'),
			nudgeFrequency: document.getElementById('nudgeFrequency'),
			protectedFilePatterns: document.getElementById('protectedFilePatterns')
		};

		function parseList(value) {
			return String(value || '')
				.split(/\r?\n|,/)
				.map((item) => item.trim())
				.filter(Boolean);
		}

		function applyState(state) {
			fields.enabled.checked = Boolean(state.enabled);
			fields.debug.checked = Boolean(state.debug);
			fields.dedupEnabled.checked = Boolean(state.deduplication?.enabled);
			fields.dedupProtectedTools.value = (state.deduplication?.protectedTools || []).join('\n');
			fields.purgeEnabled.checked = Boolean(state.purgeErrors?.enabled);
			fields.purgeTurns.value = String(state.purgeErrors?.turns ?? 0);
			fields.purgeProtectedTools.value = (state.purgeErrors?.protectedTools || []).join('\n');
			fields.compressMode.value = state.compress?.mode || 'message';
			fields.compressPermission.value = state.compress?.permission || 'allow';
			fields.showCompression.checked = Boolean(state.compress?.showCompression);
			fields.nudgeFrequency.value = String(state.compress?.nudgeFrequency ?? 0);
			fields.protectedFilePatterns.value = (state.protectedFilePatterns || []).join('\n');
		}

		function collectState() {
			return {
				enabled: fields.enabled.checked,
				debug: fields.debug.checked,
				deduplication: {
					enabled: fields.dedupEnabled.checked,
					protectedTools: parseList(fields.dedupProtectedTools.value)
				},
				purgeErrors: {
					enabled: fields.purgeEnabled.checked,
					turns: Math.max(0, Number(fields.purgeTurns.value || 0)),
					protectedTools: parseList(fields.purgeProtectedTools.value)
				},
				compress: {
					mode: fields.compressMode.value,
					permission: fields.compressPermission.value,
					showCompression: fields.showCompression.checked,
					nudgeFrequency: Math.max(0, Number(fields.nudgeFrequency.value || 0))
				},
				protectedFilePatterns: parseList(fields.protectedFilePatterns.value)
			};
		}

		function setBusy(busy) {
			saveButton.disabled = busy;
			reloadButton.disabled = busy;
			saveButton.textContent = busy ? 'Saving…' : 'Save changes';
		}

		document.getElementById('settings-form').addEventListener('submit', (event) => {
			event.preventDefault();
			setBusy(true);
			status.textContent = 'Saving to contexty.config.json…';
			vscode.postMessage({ type: 'save', state: collectState() });
		});

		reloadButton.addEventListener('click', () => {
			vscode.postMessage({ type: 'reload' });
		});

		window.addEventListener('message', (event) => {
			const message = event.data;
			if (!message || typeof message.type !== 'string') {
				return;
			}

			if (message.type === 'saved') {
				setBusy(false);
				status.textContent = 'Saved.';
				if (message.state) {
					applyState(message.state);
				}
			}

			if (message.type === 'error') {
				setBusy(false);
				status.textContent = message.message || 'Unable to save settings.';
			}

			if (message.type === 'reload') {
				applyState(message.state || initialState);
				setBusy(false);
				status.textContent = 'Reloaded from disk.';
			}
		});

		applyState(initialState);
	</script>
</body>
</html>`;
}

export async function openPruningSettingsPanel(context: vscode.ExtensionContext): Promise<void> {
	const workspaceRoot = getWorkspaceRoot();
	if (!workspaceRoot) {
		vscode.window.showWarningMessage('Open a file-based workspace to edit DCP settings.');
		return;
	}

	const panel = vscode.window.createWebviewPanel(
		PRUNING_SETTINGS_VIEW_TYPE,
		'Contexty DCP Settings',
		vscode.ViewColumn.One,
		{
			enableScripts: true,
			retainContextWhenHidden: true
		}
	);

	const applyState = async (state: PruningSettingsFormState): Promise<void> => {
		panel.webview.postMessage({ type: 'reload', state });
	};

	let currentState = await loadPruningSettings(workspaceRoot);
	panel.webview.html = renderPruningSettingsWebview(panel.webview, currentState);

	const disposable = panel.webview.onDidReceiveMessage(async (message: unknown) => {
		if (!isRecord(message) || typeof message.type !== 'string') {
			return;
		}

		if (message.type === 'save') {
			try {
				const nextState = isRecord(message.state) ? message.state : {};
				currentState = await savePruningSettings(workspaceRoot, {
					enabled: typeof nextState.enabled === 'boolean' ? nextState.enabled : currentState.enabled,
					debug: typeof nextState.debug === 'boolean' ? nextState.debug : currentState.debug,
					deduplication: {
						enabled: isRecord(nextState.deduplication) && typeof nextState.deduplication.enabled === 'boolean' ? nextState.deduplication.enabled : currentState.deduplication.enabled,
						protectedTools: isRecord(nextState.deduplication) ? toStringArray(nextState.deduplication.protectedTools, currentState.deduplication.protectedTools) : [...currentState.deduplication.protectedTools]
					},
					purgeErrors: {
						enabled: isRecord(nextState.purgeErrors) && typeof nextState.purgeErrors.enabled === 'boolean' ? nextState.purgeErrors.enabled : currentState.purgeErrors.enabled,
						turns: isRecord(nextState.purgeErrors) ? toNumber(nextState.purgeErrors.turns, currentState.purgeErrors.turns) : currentState.purgeErrors.turns,
						protectedTools: isRecord(nextState.purgeErrors) ? toStringArray(nextState.purgeErrors.protectedTools, currentState.purgeErrors.protectedTools) : [...currentState.purgeErrors.protectedTools]
					},
					compress: {
						mode: isRecord(nextState.compress) ? toEnum(nextState.compress.mode, ['range', 'message'] as const, currentState.compress.mode) : currentState.compress.mode,
						permission: isRecord(nextState.compress) ? toEnum(nextState.compress.permission, ['ask', 'allow', 'deny'] as const, currentState.compress.permission) : currentState.compress.permission,
						showCompression: isRecord(nextState.compress) && typeof nextState.compress.showCompression === 'boolean' ? nextState.compress.showCompression : currentState.compress.showCompression,
						nudgeFrequency: isRecord(nextState.compress) ? toNumber(nextState.compress.nudgeFrequency, currentState.compress.nudgeFrequency) : currentState.compress.nudgeFrequency
					},
					protectedFilePatterns: toStringArray(nextState.protectedFilePatterns, currentState.protectedFilePatterns)
				});
				await applyState(currentState);
				panel.webview.postMessage({ type: 'saved', state: currentState });
			} catch (error) {
				panel.webview.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
			}
		}

		if (message.type === 'reload') {
			currentState = await loadPruningSettings(workspaceRoot);
			await applyState(currentState);
		}
	});

	context.subscriptions.push(disposable, panel);
	panel.onDidDispose(() => disposable.dispose());
}
