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
		metadata?: { preview: string; truncated: boolean };
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

function summarizeToolPart(part: ToolPart): { label: string; tooltip: string } {
	const output = typeof part.state.output === 'string' ? part.state.output : '';
	const lines = output.split(/\r?\n/);
	let firstLine: number | undefined;
	let lastLine: number | undefined;
	let preview = '';

	for (const line of lines) {
		const match = line.match(/^(\d+)\|\s?(.*)$/);
		if (match) {
			const lineNo = Number.parseInt(match[1], 10);
			if (!Number.isNaN(lineNo)) {
				if (firstLine === undefined) {
					firstLine = lineNo;
				}
				lastLine = lineNo;
			}
			if (!preview && match[2].trim()) {
				preview = match[2].trim();
			}
			continue;
		}
		if (!preview && line.trim()) {
			preview = line.trim();
		}
	}

	let rangeLabel = '';
	if (firstLine !== undefined && lastLine !== undefined) {
		rangeLabel = firstLine === lastLine ? `L${firstLine}` : `L${firstLine}-${lastLine}`;
	}

	let label = rangeLabel || `Part ${part.id.slice(0, 8)}`;
	if (preview) {
		label = rangeLabel ? `${rangeLabel}: ${preview}` : preview;
	}
	if (label.length > 80) {
		label = `${label.slice(0, 77)}...`;
	}

	const tooltip = rangeLabel ? `${rangeLabel} • ID: ${part.id}` : `ID: ${part.id}`;
	return { label, tooltip };
}

function isFullFilePart(part: ToolPart): boolean {
	return part.state.metadata?.truncated === false;
}

async function formatFileWithNumbers(uri: vscode.Uri): Promise<{
	output: string;
	preview: string;
	truncated: boolean;
	lineCount: number;
}> {
	try {
		const buf = await vscode.workspace.fs.readFile(uri);
		const text = Buffer.from(buf).toString('utf8');
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
	private partsByFile = new Map<string, ToolPart[]>();
	private readonly roots: Array<{
		rootUri: vscode.Uri;
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
					rootUri: wf.uri,
					rootFsPathLower,
					contextDirUri,
					partsUri: vscode.Uri.joinPath(contextDirUri, 'tool-parts.json'),
					banUri: vscode.Uri.joinPath(contextDirUri, 'tool-parts.blacklist.json')
				};
			});
		this.load();
		// Best-effort: keep the JSON file in sync on startup.
		void this.writeCheckedFile();
		void this.refreshFromDisk();
	}

	isChecked(uri: vscode.Uri): boolean {
		const key = asKey(uri);
		const parts = this.partsByFile.get(key);
		if (parts && parts.length > 0) {
			return true;
		}
		const id = this.checked.get(key);
		return !!(id && !this.banned.has(id));
	}

	getPartCountForFile(uri: vscode.Uri): number {
		const key = asKey(uri);
		return this.partsByFile.get(key)?.length ?? 0;
	}

	getPartIdsForFile(uri: vscode.Uri): string[] {
		const key = asKey(uri);
		const parts = this.partsByFile.get(key);
		if (!parts) {
			return [];
		}
		return parts.map((part) => part.id);
	}

	getRootsWithParts(): Array<{ uri: vscode.Uri; label: string }> {
		const rootsWithParts = new Set<string>();
		for (const { rootUri } of this.roots) {
			for (const key of this.partsByFile.keys()) {
				try {
					const uri = vscode.Uri.parse(key);
					if (uri.fsPath.toLowerCase().startsWith(rootUri.fsPath.toLowerCase() + path.sep)) {
						rootsWithParts.add(rootUri.toString());
						break;
					}
				} catch {
					continue;
				}
			}
		}
		return this.roots
			.filter((root) => rootsWithParts.has(root.rootUri.toString()))
			.map((root) => {
				const folder = vscode.workspace.getWorkspaceFolder(root.rootUri);
				return { uri: root.rootUri, label: folder?.name ?? path.basename(root.rootUri.fsPath) };
			});
	}

	getChildrenForPath(
		baseUri: vscode.Uri
	): { dirs: Array<{ uri: vscode.Uri; label: string }>; files: Array<{ uri: vscode.Uri; label: string }> } {
		const dirs = new Map<string, string>();
		const files = new Map<string, string>();
		const basePath = baseUri.fsPath;
		const baseLower = basePath.toLowerCase();
		for (const key of this.partsByFile.keys()) {
			let fileUri: vscode.Uri;
			try {
				fileUri = vscode.Uri.parse(key);
			} catch {
				continue;
			}
			const filePath = fileUri.fsPath;
			if (!filePath.toLowerCase().startsWith(baseLower + path.sep)) {
				continue;
			}
			const rel = path.relative(basePath, filePath);
			if (!rel || rel.startsWith('..')) {
				continue;
			}
			const segments = rel.split(path.sep);
			if (segments.length === 1) {
				files.set(filePath, segments[0]);
			} else {
				const dirPath = path.join(basePath, segments[0]);
				dirs.set(dirPath, segments[0]);
			}
		}
		const dirEntries = [...dirs.entries()]
			.map(([dirPath, label]) => ({ uri: vscode.Uri.file(dirPath), label }))
			.sort((a, b) => (a.label || "").localeCompare(b.label || ""));
		const fileEntries = [...files.entries()]
			.map(([filePath, label]) => ({ uri: vscode.Uri.file(filePath), label }))
			.sort((a, b) => (a.label || "").localeCompare(b.label || ""));
		return { dirs: dirEntries, files: fileEntries };
	}

	getPartsForFile(
		uri: vscode.Uri
	): Array<{ id: string; label: string; tooltip: string; truncated: boolean }> {
		const key = asKey(uri);
		const parts = this.partsByFile.get(key);
		if (!parts || parts.length === 0) {
			return [];
		}
		const sorted = [...parts].sort((a, b) => {
			const aTime = a.state.time?.start ?? 0;
			const bTime = b.state.time?.start ?? 0;
			if (aTime !== bTime) {
				return aTime - bTime;
			}
			return (a.id || "").localeCompare(b.id || "");
		});
		return sorted.map((part) => {
			const { label, tooltip } = summarizeToolPart(part);
			return { id: part.id, label, tooltip, truncated: !isFullFilePart(part) };
		});
	}

	getLineRangesForFile(uri: vscode.Uri): Array<{ start: number; end: number }> {
		const key = asKey(uri);
		const parts = this.partsByFile.get(key);
		if (!parts || parts.length === 0) {
			return [];
		}
		const ranges: Array<{ start: number; end: number }> = [];
		for (const part of parts) {
			const output = typeof part.state.output === 'string' ? part.state.output : '';
			const lines = output.split(/\r?\n/);
			let minLine: number | undefined;
			let maxLine: number | undefined;
			for (const line of lines) {
				const match = line.match(/^(\d+)\|\s?/);
				if (!match) {
					continue;
				}
				const lineNo = Number.parseInt(match[1], 10);
				if (Number.isNaN(lineNo)) {
					continue;
				}
				if (minLine === undefined || lineNo < minLine) {
					minLine = lineNo;
				}
				if (maxLine === undefined || lineNo > maxLine) {
					maxLine = lineNo;
				}
			}
			if (minLine !== undefined && maxLine !== undefined) {
				ranges.push({ start: minLine - 1, end: maxLine - 1 });
			}
		}
		return ranges;
	}

	async banPart(partId: string): Promise<void> {
		await this.syncCheckedFromExternalParts();
		if (this.banned.has(partId)) {
			return;
		}
		this.banned.add(partId);
		await this.writeCheckedFile();
		await this.syncCheckedFromExternalParts();
	}

	async banPartsUnderPath(baseUri: vscode.Uri): Promise<void> {
		await this.syncCheckedFromExternalParts();
		const basePath = baseUri.fsPath;
		const baseLower = basePath.toLowerCase();
		let changed = false;

		for (const [key, parts] of this.partsByFile.entries()) {
			try {
				const fileUri = vscode.Uri.parse(key);
				const filePath = fileUri.fsPath;
				const filePathLower = filePath.toLowerCase();
				if (filePathLower === baseLower || filePathLower.startsWith(baseLower + path.sep)) {
					for (const part of parts) {
						if (!this.banned.has(part.id)) {
							this.banned.add(part.id);
							changed = true;
						}
					}
				}
			} catch {
				continue;
			}
		}

		if (changed) {
			await this.writeCheckedFile();
			await this.syncCheckedFromExternalParts();
		}
	}

	async refreshFromDisk(): Promise<void> {
		await this.syncCheckedFromExternalParts();
	}

	async addSelectionPart(
		document: vscode.TextDocument,
		selection: vscode.Selection
	): Promise<void> {
		if (selection.isEmpty || document.uri.scheme !== 'file') {
			return;
		}

		await this.syncCheckedFromExternalParts();

		const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
		const root = this.roots.find((entry) => entry.rootUri.toString() === workspaceFolder?.uri.toString());
		if (!root) {
			return;
		}

		const startLine = selection.start.line;
		const fullEnd = document.lineAt(document.lineCount - 1).range.end;
		const isFullSelection =
			selection.start.isEqual(new vscode.Position(0, 0)) &&
			(selection.end.isEqual(fullEnd) ||
				(selection.end.line === document.lineCount && selection.end.character === 0));

		let endLine = selection.end.line;
		if (selection.end.character === 0 && selection.end.line > selection.start.line) {
			endLine = selection.end.line - 1;
		}
		if (endLine < startLine) {
			return;
		}

		const numberedLines: string[] = [];
		for (let line = startLine; line <= endLine; line++) {
			const text = document.lineAt(line).text;
			numberedLines.push(`${String(line + 1).padStart(5, '0')}| ${text}`);
		}

		const totalLines = document.lineCount;
		const output = `<file>\n${numberedLines.join('\n')}\n\n(Excerpt lines ${startLine + 1}-${endLine + 1} of total ${totalLines} lines)\n</file>`;
		const previewLimit = 1000;
		const preview = output.slice(0, previewLimit);
		const truncated = !isFullSelection;

		const timestamp = Date.now();
		const title = path.relative(root.rootUri.fsPath, document.uri.fsPath) || document.uri.fsPath;
		const part: ToolPart = {
			id: generateCustomId('prt'),
			sessionID: this.sessionId,
			messageID: generateCustomId('msg'),
			type: 'tool',
			callID: generateCustomId('call'),
			tool: 'read',
			state: {
				status: 'completed',
				input: { filePath: document.uri.fsPath },
				output,
				title,
				metadata: { preview, truncated },
				time: { start: timestamp, end: timestamp }
			}
		};

		let existingParts: ToolPart[] = [];
		try {
			const raw = await vscode.workspace.fs.readFile(root.partsUri);
			const parsed = JSON.parse(Buffer.from(raw).toString('utf8')) as { parts?: ToolPart[] };
			if (Array.isArray(parsed.parts)) {
				existingParts = parsed.parts;
			}
		} catch {
			// ignore
		}
		existingParts.push(part);
		const partsContents = Buffer.from(JSON.stringify({ parts: existingParts }, null, 2), 'utf8');
		try {
			await vscode.workspace.fs.createDirectory(root.contextDirUri);
		} catch {
			// ignore
		}
		await vscode.workspace.fs.writeFile(root.partsUri, partsContents);

		await this.syncCheckedFromExternalParts();
	}

	async toggleChecked(uri: vscode.Uri): Promise<void> {
		await this.setChecked(uri, !this.isChecked(uri));
	}

	async setChecked(uri: vscode.Uri, checked: boolean): Promise<void> {
		await this.setCheckedMany([{ uri, checked }]);
	}

	async setCheckedMany(updates: Array<{ uri: vscode.Uri; checked: boolean }>): Promise<void> {
		// 먼저 JSON에서 현재 상태를 로드
		await this.syncCheckedFromExternalParts();

		let changed = false;
		for (const { uri, checked } of updates) {
			const key = asKey(uri);
			if (checked) {
				const newId = generateCustomId('prt');
				this.checked.set(key, newId);
				changed = true;
			} else {
				const parts = this.partsByFile.get(key) ?? [];
				for (const part of parts) {
					if (!this.banned.has(part.id)) {
						this.banned.add(part.id);
						changed = true;
					}
				}
			}
		}

		if (!changed) {
			return;
		}

		await this.writeCheckedFile();
		await this.syncCheckedFromExternalParts();
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
		banned.sort((a, b) => (a || "").localeCompare(b || ""));

		for (const { rootFsPathLower, contextDirUri, partsUri, banUri } of this.roots) {
			try {
				await vscode.workspace.fs.createDirectory(contextDirUri);
			} catch {
				// best-effort; ignore
			}
			let existingParts: ToolPart[] = [];
			try {
				const raw = await vscode.workspace.fs.readFile(partsUri);
				const parsed = JSON.parse(Buffer.from(raw).toString('utf8')) as { parts?: unknown[] };
				if (Array.isArray(parsed.parts)) {
					existingParts = parsed.parts.filter((p: any): p is ToolPart =>
						typeof p?.id === 'string' &&
						typeof p?.state?.input?.filePath === 'string'
					);
				}
			} catch {
				// ignore
			}
			const partsMap = new Map(existingParts.map((p) => [p.id, p] as const));

			const parts: ToolPart[] = [...existingParts];
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
				const part: ToolPart = {
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
						metadata: { preview, truncated },
						time: { start: timestamp, end: timestamp }
					},
				};
				partsMap.set(id, part);
			}
			const mergedParts = [...partsMap.values()];
			mergedParts.sort((a, b) => (a.state.input?.filePath || "").localeCompare(b.state.input?.filePath || ""));

			const partsContents = Buffer.from(JSON.stringify({ parts: mergedParts }, null, 2), 'utf8');
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
		// JSON 파일에서 직접 읽음 (memento 무시)
		this.checked = new Map();
		this.banned = new Set();
		this.partsByFile = new Map();
	}



	private async syncCheckedFromExternalParts(): Promise<void> {
		// JSON 파일에서 checked와 banned를 새로 로드 (memento 무시)
		this.checked = new Map();
		this.banned = new Set();
		this.partsByFile = new Map();

		const toolPartUris = await vscode.workspace.findFiles('**/.contexty/tool-parts.json', '**/node_modules/**');
		for (const partsUri of toolPartUris) {
			const contextDirUri = vscode.Uri.file(path.dirname(partsUri.fsPath));
			const banUri = vscode.Uri.joinPath(contextDirUri, 'tool-parts.blacklist.json');
			let localBlacklist = new Set<string>();
			try {
				const banRaw = await vscode.workspace.fs.readFile(banUri);
				const banParsed = JSON.parse(Buffer.from(banRaw).toString('utf8')) as { ids?: unknown };
				if (Array.isArray(banParsed.ids)) {
					for (const id of banParsed.ids) {
						if (typeof id === 'string') {
							this.banned.add(id);
							localBlacklist.add(id);
						}
					}
				}
			} catch {
				// 파일 없거나 파싱 실패시 무시
			}

			let raw: Uint8Array;
			try {
				raw = await vscode.workspace.fs.readFile(partsUri);
			} catch {
				continue;
			}
			let parsed: unknown;
			try {
				parsed = JSON.parse(Buffer.from(raw).toString('utf8'));
			} catch {
				continue;
			}
			const parts = (parsed as { parts?: unknown }).parts;
			if (!Array.isArray(parts)) {
				continue;
			}
			for (const part of parts) {
				if (!part || typeof part !== 'object') {
					continue;
				}
				const p = part as { id?: unknown; state?: unknown };
				const state = (p.state as ToolPart['state'] | undefined);
				const filePath = state?.input?.filePath;
				if (typeof filePath !== 'string') {
					continue;
				}
				const id = typeof p.id === 'string' ? p.id : generateCustomId('prt');
				if (localBlacklist.has(id) || this.banned.has(id)) {
					continue;
				}
				const uri = vscode.Uri.file(filePath);
				if (!vscode.workspace.getWorkspaceFolder(uri)) {
					continue;
				}
				const key = asKey(uri);
				const toolPart: ToolPart = {
					...(part as ToolPart),
					id,
					state: {
						...(state ?? { status: 'completed', input: { filePath } }),
						input: { filePath }
					}
				};
				const list = this.partsByFile.get(key) ?? [];
				list.push(toolPart);
				this.partsByFile.set(key, list);
			}
		}
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
