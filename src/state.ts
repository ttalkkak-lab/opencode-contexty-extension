import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as path from 'path';

type ToolPart = {
	id: string;
	sessionID: string;
	messageID: string;
	type: 'tool';
	callID: string;
	tool: string;
	state: {
		status: string;
		input: { filePath: string };
		output?: string;
		title?: string;
		metadata?: {
			preview?: string;
			truncated?: boolean;
		};
		time?: { start: number; end: number };
	};
	metadata?: Record<string, unknown>;
};

type StoredStateV2 = {
	version: 2;
	checked: string[];
};

type StoredStateV3 = {
	version: 3;
	checked: Array<{ uri: string; id: string }>;
};

type StoredStateV4 = {
	version: 4;
	checked: Array<{ uri: string; id: string }>;
	banned: string[];
};

const STATE_KEY = 'kciMirror.state';
const SESSION_KEY = 'kciMirror.sessionId';

function asKey(uri: vscode.Uri): string {
	// Use full URI string so multi-root workspaces stay unique.
	return uri.toString();
}

function generateCustomId(prefix: string): string {
	// Keep lexicographic ordering roughly aligned with creation time.
	const timestampHex = Date.now().toString(16).padStart(12, '0');
	const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
	let randomPart = '';
	for (let i = 0; i < 14; i++) {
		randomPart += alphabet[crypto.randomInt(0, alphabet.length)];
	}
	return `${prefix}_${timestampHex}${randomPart}`;
}

function generateOpenAIItemId(): string {
	// Match shape: fc_ + 50 hex chars (25 bytes)
	return `fc_${crypto.randomBytes(25).toString('hex')}`;
}

async function formatFileWithNumbers(uri: vscode.Uri): Promise<{
	output: string;
	preview: string;
	truncated: boolean;
	lineCount: number;
}> {
	try {
		const buf = await vscode.workspace.fs.readFile(uri);
		const text = buf.toString('utf8');
		const lines = text.split(/\r?\n/);
		const numbered = lines.map((line, idx) => `${String(idx + 1).padStart(5, '0')}| ${line}`);
		const bodyWithNumbers = numbered.join('\n');
		const endLine = `(End of file - total ${lines.length} lines)`;
		const output = `<file>\n${bodyWithNumbers}\n\n${endLine}\n</file>`;
		const rawBody = lines.join('\n');
		const maxPreviewLen = 1000;
		const truncated = rawBody.length > maxPreviewLen;
		const previewBody = truncated ? rawBody.slice(0, maxPreviewLen) : rawBody;
		const preview = previewBody;
		return { output, preview, truncated, lineCount: lines.length };
	} catch {
		return { output: '', preview: '', truncated: false, lineCount: 0 };
	}
}

export class MirrorState {
	// Key: full URI string (uri.toString()), Value: stable generated id.
	private checked = new Map<string, string>();
	private banned = new Set<string>();
	private readonly roots: Array<{
		rootFsPathLower: string;
		contextDirUri: vscode.Uri;
		partsUri: vscode.Uri;
		banUri: vscode.Uri;
	}>;
	private readonly sessionId: string;

	constructor(
		private readonly memento: vscode.Memento,
		workspaceFolders?: readonly vscode.WorkspaceFolder[]
	) {
		this.sessionId = this.loadOrCreateSessionId();
		// Persist checked files at each workspace root.
		this.roots = (workspaceFolders ?? [])
			.filter((wf) => wf.uri.scheme === 'file')
			.map((wf) => {
				const rootFsPathLower = wf.uri.fsPath.toLowerCase();
				const contextDirUri = vscode.Uri.joinPath(wf.uri, '.contexty');
				return {
					rootFsPathLower,
					contextDirUri,
					partsUri: vscode.Uri.joinPath(contextDirUri, 'tool-parts.json'),
					banUri: vscode.Uri.joinPath(contextDirUri, 'tool-parts.blacklist.json')
				};
			});
		this.load();
		// Best-effort: keep the JSON file in sync on startup.
		void this.writeCheckedFile();
	}

	isChecked(uri: vscode.Uri): boolean {
		return this.checked.has(asKey(uri));
	}

	async toggleChecked(uri: vscode.Uri): Promise<void> {
		await this.setChecked(uri, !this.isChecked(uri));
	}

	async setChecked(uri: vscode.Uri, checked: boolean): Promise<void> {
		await this.setCheckedMany([{ uri, checked }]);
	}

	async setCheckedMany(updates: Array<{ uri: vscode.Uri; checked: boolean }>): Promise<void> {
		let changed = false;
		for (const { uri, checked } of updates) {
			const key = asKey(uri);
			if (checked) {
				if (!this.checked.has(key)) {
					this.checked.set(key, generateCustomId('prt'));
					changed = true;
				}
			} else {
				const existingId = this.checked.get(key);
				if (existingId) {
					this.checked.delete(key);
					if (!this.banned.has(existingId)) {
						this.banned.add(existingId);
					}
					changed = true;
				}
			}
		}

		if (!changed) {
			return;
		}

		await this.save();
		await this.writeCheckedFile();
	}

	private async writeCheckedFile(): Promise<void> {
		if (this.roots.length === 0) {
			return;
		}

		// Pre-parse checked URIs once.
		const checkedEntries: Array<{ uri: vscode.Uri; id: string }> = [];
		for (const [key, id] of this.checked.entries()) {
			try {
				checkedEntries.push({ uri: vscode.Uri.parse(key), id });
			} catch {
				// Ignore invalid entries.
			}
		}

		const banned = [...this.banned];
		banned.sort((a, b) => a.localeCompare(b));

		for (const { rootFsPathLower, contextDirUri, partsUri, banUri } of this.roots) {
			try {
				await vscode.workspace.fs.createDirectory(contextDirUri);
			} catch {
				// best-effort; ignore
			}
			const parts: ToolPart[] = [];
			for (const { uri, id } of checkedEntries) {
				if (uri.scheme !== 'file') {
					continue;
				}
				const fsPathLower = uri.fsPath.toLowerCase();
				if (fsPathLower === rootFsPathLower || !fsPathLower.startsWith(rootFsPathLower + path.sep)) {
					continue;
				}

				try {
					const stat = await vscode.workspace.fs.stat(uri);
					if ((stat.type & vscode.FileType.File) !== vscode.FileType.File) {
						continue;
					}
				} catch {
					continue;
				}

				const timestamp = Date.now();
				const { output, preview, truncated } = await formatFileWithNumbers(uri);
				const messageId = generateCustomId('msg');
				const callId = generateCustomId('call');
				const itemId = generateOpenAIItemId();
				parts.push({
					id,
					sessionID: this.sessionId,
					messageID: messageId,
					type: 'tool',
					callID: callId,
					tool: 'read',
					state: {
						status: 'completed',
						input: { filePath: uri.fsPath },
						output,
						title: uri.fsPath,
						metadata: {
							preview,
							truncated
						},
						time: { start: timestamp, end: timestamp }
					},
					metadata: {
						openai: {
							itemId
						}
					}
				});
			}
			parts.sort((a, b) => a.state.input.filePath.localeCompare(b.state.input.filePath));

			const partsContents = Buffer.from(JSON.stringify({ parts }, null, 2), 'utf8');
			try {
				await vscode.workspace.fs.writeFile(partsUri, partsContents);
			} catch {
				// Ignore file sync errors; workspaceState is still the source of truth.
			}

			const banContents = Buffer.from(JSON.stringify({ ids: banned }, null, 2), 'utf8');
			try {
				await vscode.workspace.fs.writeFile(banUri, banContents);
			} catch {
				// Ignore file sync errors; workspaceState is still the source of truth.
			}
		}
	}

	private load(): void {
		const storedAny = this.memento.get<unknown>(STATE_KEY);
		if (!storedAny || typeof storedAny !== 'object') {
			return;
		}

		// Migration: version 1 stored `pinned` and `ignored`. We convert both into a single
		// `checked` set (union) so users don't lose their previous marks.
		const storedV1 = storedAny as { version?: unknown; pinned?: unknown; ignored?: unknown };
		if (storedV1.version === 1) {
			const pinned = Array.isArray(storedV1.pinned) ? storedV1.pinned : [];
			const ignored = Array.isArray(storedV1.ignored) ? storedV1.ignored : [];
			this.checked = new Map(
				[...(pinned as string[]), ...(ignored as string[])].map((uriStr) => [uriStr, generateCustomId('prt')])
			);
			return;
		}

		const storedV4 = storedAny as StoredStateV4;
		if (storedV4.version === 4) {
			this.checked = new Map(
				(storedV4.checked ?? [])
					.filter((x) => x && typeof x.uri === 'string' && typeof x.id === 'string')
					.map((x) => [x.uri, x.id])
			);
			this.banned = new Set((storedV4.banned ?? []).filter((x) => typeof x === 'string'));
			return;
		}

		const storedV3 = storedAny as StoredStateV3;
		if (storedV3.version === 3) {
			this.checked = new Map(
				(storedV3.checked ?? [])
					.filter((x) => x && typeof x.uri === 'string' && typeof x.id === 'string')
					.map((x) => [x.uri, x.id])
			);
			return;
		}

		const storedV2 = storedAny as StoredStateV2;
		if (storedV2.version !== 2) {
			return;
		}
		this.checked = new Map((storedV2.checked ?? []).map((uriStr) => [uriStr, generateCustomId('prt')]));
	}

	private async save(): Promise<void> {
		const stored: StoredStateV4 = {
			version: 4,
			checked: [...this.checked.entries()].map(([uri, id]) => ({ uri, id })),
			banned: [...this.banned]
		};
		await this.memento.update(STATE_KEY, stored);
	}

	private loadOrCreateSessionId(): string {
		const existing = this.memento.get<string>(SESSION_KEY);
		if (existing && typeof existing === 'string') {
			return existing;
		}
		const fresh = generateCustomId('ses');
		void this.memento.update(SESSION_KEY, fresh);
		return fresh;
	}
}
