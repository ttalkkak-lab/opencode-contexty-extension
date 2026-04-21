import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as path from 'path';
import {
	deserializePruningSessionData,
	type CompressionBlockView,
	type PruningEntry,
	type PruningSessionData,
	type SerializedPruningSessionData,
} from './state.pruning.js';
export { deserializePruningSessionData } from './state.pruning.js';
export type { CompressionBlockView, PruningEntry, PruningSessionData } from './state.pruning.js';

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
		time?: { start: number; end: number; compacted?: boolean };
	};
	metadata?: Record<string, unknown>;
};

const SESSION_KEY = 'contexty.hscmm.sessionId';

function asKey(uri: vscode.Uri): string {
	return uri.toString();
}

function generateCustomId(prefix: string): string {
	const timestampHex = Date.now().toString(16).padStart(12, '0');
	const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
	let randomPart = '';
	for (let i = 0; i < 14; i++) {
		randomPart += alphabet[crypto.randomInt(0, alphabet.length)];
	}
	return `${prefix}_${timestampHex}${randomPart}`;
}

function summarizeToolPart(part: ToolPart): { label: string; tooltip: string } {
	const output = typeof part.state.output === 'string' ? part.state.output : '';
	const lines = output.split(/\r?\n/);
	let firstLine: number | undefined;
	let lastLine: number | undefined;
	let preview = '';

	for (const line of lines) {
		const oldFormat = line.match(/^(\d+)\|\s?(.*)$/);
		const newFormat = line.match(/^(\d+):\s(.*)$/);
		const match = oldFormat ?? newFormat;
		if (match) {
			const lineNo = Number.parseInt(match[1], 10);
			if (!Number.isNaN(lineNo)) {
				if (firstLine === undefined) {
					firstLine = lineNo;
				}
				lastLine = lineNo;
			}
			const content = oldFormat ? match[2] : match![2];
			if (!preview && content.trim()) {
				preview = content.trim();
			}
			continue;
		}
		if (!preview && line.trim() && !line.trim().startsWith('<') ) {
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

const pruningWatchers = new Map<string, vscode.FileSystemWatcher>();
const pruningWatcherTimers = new Map<string, ReturnType<typeof setTimeout>>();

async function readJSON<T>(filePath: string): Promise<T | null> {
	try {
		const raw = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
		return JSON.parse(Buffer.from(raw).toString('utf8')) as T;
	} catch {
		return null;
	}
}

function pruningStatePath(workspaceRoot: string, sessionId: string): string {
	return path.join(workspaceRoot, '.contexty', 'sessions', sessionId, 'pruning-state.json');
}

function pruningStatePattern(workspaceRoot: string, sessionId: string): vscode.RelativePattern {
	return new vscode.RelativePattern(vscode.Uri.file(workspaceRoot), path.join('.contexty', 'sessions', sessionId, 'pruning-state.json'));
}

export async function loadPruningHistory(workspaceRoot: string, sessionId: string): Promise<PruningSessionData | null> {
	const raw = await readJSON<SerializedPruningSessionData>(pruningStatePath(workspaceRoot, sessionId));
	if (!raw) {
		return null;
	}

	return deserializePruningSessionData(raw);
}

export function getActivePruningEntries(data: PruningSessionData): PruningEntry[] {
	return data.entries.filter((entry): entry is PruningEntry => !!entry);
}

export function getCompressionBlocks(data: PruningSessionData): CompressionBlockView[] {
	return data.blocks;
}

export async function watchPruningState(
	workspaceRoot: string,
	sessionId: string,
	onChange: (data: PruningSessionData) => void
): Promise<void> {
	const key = pruningStatePath(workspaceRoot, sessionId);
	pruningWatchers.get(key)?.dispose();
	const watcher = vscode.workspace.createFileSystemWatcher(pruningStatePattern(workspaceRoot, sessionId));
	pruningWatchers.set(key, watcher);

	const refresh = async () => {
		const data = await loadPruningHistory(workspaceRoot, sessionId);
		if (data) {
			onChange(data);
		}
	};

	const queueRefresh = () => {
		const existing = pruningWatcherTimers.get(key);
		if (existing) {
			clearTimeout(existing);
		}
		const timer = setTimeout(() => {
			pruningWatcherTimers.delete(key);
			void refresh();
		}, 150);
		pruningWatcherTimers.set(key, timer);
	};

	watcher.onDidCreate(queueRefresh);
	watcher.onDidChange(queueRefresh);
	watcher.onDidDelete(queueRefresh);
	await refresh();
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

export type FileContextStat = {
	uri: vscode.Uri;
	label: string;
	tokens: number;
	percentage: number;
	partCount: number;
};

export class ContextState {
	private checked = new Map<string, string>();
	private banned = new Set<string>();
	private partsByFile = new Map<string, ToolPart[]>();
	private pruningDataByWorkspace = new Map<string, PruningSessionData>();
	public compactedParts: ToolPart[] = [];
	private refreshVersion = 0;
	private appliedRefreshVersion = 0;
	private refreshInFlight: Promise<void> | undefined;
	private readonly roots: Array<{
		rootUri: vscode.Uri;
		rootFsPathLower: string;
	}>;
	private readonly sessionId: string;
	private currentSessionId: string | undefined;

	constructor(
		private readonly memento: vscode.Memento,
		workspaceFolders?: readonly vscode.WorkspaceFolder[]
	) {
		this.sessionId = this.loadOrCreateSessionId();
		this.roots = (workspaceFolders ?? [])
			.filter((wf) => wf.uri.scheme === 'file')
			.map((wf) => ({
				rootUri: wf.uri,
				rootFsPathLower: wf.uri.fsPath.toLowerCase()
			}));
		this.load();
		void this.ensureGitignoreForRoots();
		void this.refreshFromDisk().then(() => this.writeCheckedFile());
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

	setSessionId(sessionId: string | undefined): void {
		this.currentSessionId = sessionId;
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

	private getFileTokens(uri: vscode.Uri): number {
		const key = asKey(uri);
		const parts = this.partsByFile.get(key);
		if (!parts) {
			return 0;
		}
		let total = 0;
		for (const part of parts) {
			total += this.getPartTokens(part);
		}
		return total;
	}

	private getDirTokens(dirUri: vscode.Uri): number {
		const dirPath = dirUri.fsPath.toLowerCase();
		const countedBlocks = new Set<number>();
		let total = 0;
		for (const [key, parts] of this.partsByFile.entries()) {
			let fileUri: vscode.Uri;
			try {
				fileUri = vscode.Uri.parse(key);
			} catch {
				continue;
			}
			if (!fileUri.fsPath.toLowerCase().startsWith(dirPath + path.sep)) {
				continue;
			}
			for (const part of parts) {
				total += this.getPartTokens(part, countedBlocks);
			}
		}
		return total;
	}

	getTotalTokens(): number {
		const countedBlocks = new Set<number>();
		let total = 0;
		for (const parts of this.partsByFile.values()) {
			for (const part of parts) {
				total += this.getPartTokens(part, countedBlocks);
			}
		}
		return total;
	}

	getNodeTokens(uri: vscode.Uri, nodeType: 'file' | 'dir' | 'root'): number {
		if (nodeType === 'file') {
			return this.getFileTokens(uri);
		}
		if (nodeType === 'dir' || nodeType === 'root') {
			return this.getDirTokens(uri);
		}
		return 0;
	}

	getContextStats(): FileContextStat[] {
		const totalTokens = this.getTotalTokens();
		const stats: FileContextStat[] = [];
		for (const [key, parts] of this.partsByFile.entries()) {
			let fileUri: vscode.Uri;
			try {
				fileUri = vscode.Uri.parse(key);
			} catch {
				continue;
			}
			let tokens = 0;
			for (const part of parts) {
				tokens += this.getPartTokens(part);
			}
			const relPath = vscode.workspace.asRelativePath(fileUri, false);
			stats.push({
				uri: fileUri,
				label: relPath,
				tokens,
				percentage: totalTokens > 0 ? (tokens / totalTokens) * 100 : 0,
				partCount: parts.length,
			});
		}
		stats.sort((a, b) => b.tokens - a.tokens);
		return stats;
	}

	private async ensureGitignoreForRoots(): Promise<void> {
		await Promise.all(
			this.roots.map(async ({ rootUri }) => {
				const gitignoreUri = vscode.Uri.joinPath(rootUri, '.gitignore');
				try {
					const buf = await vscode.workspace.fs.readFile(gitignoreUri);
					const text = Buffer.from(buf).toString('utf8');
					if (this.gitignoreHasContexty(text)) {
						return;
					}
					const newline = text.endsWith('\n') || text.length === 0 ? '' : '\n';
					const updated = `${text}${newline}.contexty\n`;
					await vscode.workspace.fs.writeFile(gitignoreUri, Buffer.from(updated, 'utf8'));
				} catch {
					const content = '.contexty\n';
					await vscode.workspace.fs.writeFile(gitignoreUri, Buffer.from(content, 'utf8'));
				}
			})
		);
	}

	private gitignoreHasContexty(text: string): boolean {
		const lines = text.split(/\r?\n/);
		return lines.some((line) => {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith('#')) {
				return false;
			}
			return (
				trimmed === '.contexty' ||
				trimmed === '.contexty/' ||
				trimmed === '/.contexty' ||
				trimmed === '/.contexty/'
			);
		});
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
			const match = line.match(/^(\d+)(?:\||:\s)/);
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
		await this.refreshFromDisk();
		if (this.banned.has(partId)) {
			return;
		}
		this.banned.add(partId);
		await this.writeCheckedFile();
		await this.refreshFromDisk();
	}

	async banPartsUnderPath(baseUri: vscode.Uri): Promise<void> {
		await this.refreshFromDisk();
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
			await this.refreshFromDisk();
		}
	}

	async banAllParts(): Promise<number> {
		await this.refreshFromDisk();

		let added = 0;
		for (const parts of this.partsByFile.values()) {
			for (const part of parts) {
				if (!this.banned.has(part.id)) {
					this.banned.add(part.id);
					added += 1;
				}
			}
		}

		if (added > 0) {
			await this.writeCheckedFile();
			await this.refreshFromDisk();
		}

		return added;
	}

	async refreshFromDisk(): Promise<void> {
		const requestedVersion = ++this.refreshVersion;

		while (this.appliedRefreshVersion < requestedVersion) {
			if (!this.refreshInFlight) {
				const targetVersion = this.refreshVersion;
				this.refreshInFlight = this.syncCheckedFromExternalParts(targetVersion).finally(() => {
					this.refreshInFlight = undefined;
				});
			}
			await this.refreshInFlight;
		}
	}

	async addFilePart(uri: vscode.Uri): Promise<void> {
		if (uri.scheme !== 'file') {
			return;
		}

		await this.refreshFromDisk();

		const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
		const root = this.roots.find((entry) => entry.rootUri.toString() === workspaceFolder?.uri.toString());
		if (!root) {
			return;
		}
		const contextDirUri = this.getContextDirUri(root.rootUri);
		const partsUri = this.getPartsUri(root.rootUri);

		const { output, preview, lineCount } = await formatFileWithNumbers(uri);
		if (lineCount === 0) {
			return;
		}
		const effectiveSessionId = this.getEffectiveSessionId();

		const timestamp = Date.now();
		const title = path.relative(root.rootUri.fsPath, uri.fsPath) || uri.fsPath;
		const part: ToolPart = {
			id: generateCustomId('prt'),
			sessionID: effectiveSessionId,
			messageID: generateCustomId('msg'),
			type: 'tool',
			callID: generateCustomId('call'),
			tool: 'read',
			state: {
				status: 'completed',
				input: { filePath: uri.fsPath },
				output,
				title,
				metadata: { preview, truncated: false },
				time: { start: timestamp, end: timestamp }
			}
		};

		let existingParts: ToolPart[] = [];
		try {
			const raw = await vscode.workspace.fs.readFile(partsUri);
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
			await vscode.workspace.fs.createDirectory(contextDirUri);
		} catch {
			// ignore
		}
		await vscode.workspace.fs.writeFile(partsUri, partsContents);

		await this.refreshFromDisk();
	}

	async addSelectionPart(
		document: vscode.TextDocument,
		selection: vscode.Selection
	): Promise<void> {
		if (selection.isEmpty || document.uri.scheme !== 'file') {
			return;
		}

		await this.refreshFromDisk();

		const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
		const root = this.roots.find((entry) => entry.rootUri.toString() === workspaceFolder?.uri.toString());
		if (!root) {
			return;
		}
		const contextDirUri = this.getContextDirUri(root.rootUri);
		const partsUri = this.getPartsUri(root.rootUri);
		const effectiveSessionId = this.getEffectiveSessionId();

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
			sessionID: effectiveSessionId,
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
			const raw = await vscode.workspace.fs.readFile(partsUri);
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
			await vscode.workspace.fs.createDirectory(contextDirUri);
		} catch {
			// ignore
		}
		await vscode.workspace.fs.writeFile(partsUri, partsContents);

		await this.refreshFromDisk();
	}

	private async writeCheckedFile(): Promise<void> {
		if (this.roots.length === 0) {
			return;
		}

		const checkedEntries: Array<{ uri: vscode.Uri; id: string }> = [];
		for (const [key, id] of this.checked.entries()) {
			try {
				checkedEntries.push({ uri: vscode.Uri.parse(key), id });
			} catch {
			}
		}

		const banned = [...this.banned];
		banned.sort((a, b) => (a || "").localeCompare(b || ""));
		const effectiveSessionId = this.getEffectiveSessionId();

		for (const { rootUri, rootFsPathLower } of this.roots) {
			const contextDirUri = this.getContextDirUri(rootUri);
			const partsUri = this.getPartsUri(rootUri);
			const banUri = this.getBanUri(rootUri);
			try {
				await vscode.workspace.fs.createDirectory(contextDirUri);
			} catch {
			}
			let existingParts: ToolPart[] = [];
			try {
				const raw = await vscode.workspace.fs.readFile(partsUri);
				const parsed = JSON.parse(Buffer.from(raw).toString('utf8')) as { parts?: unknown[] };
				if (Array.isArray(parsed.parts)) {
					existingParts = parsed.parts.filter((part): part is ToolPart => {
						if (!part || typeof part !== 'object') {
							return false;
						}
						const candidate = part as {
							id?: unknown;
							state?: { input?: { filePath?: unknown } };
						};
						return (
							typeof candidate.id === 'string' &&
							typeof candidate.state?.input?.filePath === 'string'
						);
					});
				}
			} catch {
			}
			const partsMap = new Map(existingParts.map((p) => [p.id, p] as const));

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
				const part: ToolPart = {
					id,
					sessionID: effectiveSessionId,
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
			}

			const banContents = Buffer.from(JSON.stringify({ ids: banned }, null, 2), 'utf8');
			try {
				await vscode.workspace.fs.writeFile(banUri, banContents);
			} catch {
			}
		}
	}

	private load(): void {
		this.checked = new Map();
		this.banned = new Set();
		this.partsByFile = new Map();
		this.pruningDataByWorkspace = new Map();
		this.compactedParts = [];
	}

	private async syncCheckedFromExternalParts(targetVersion: number): Promise<void> {
		const snapshot = await this.readExternalSnapshot();
		if (snapshot) {
			this.applySnapshot(snapshot);
		}
		this.appliedRefreshVersion = targetVersion;
	}

	private async readExternalSnapshot(): Promise<{
		checked: Map<string, string>;
		banned: Set<string>;
		partsByFile: Map<string, ToolPart[]>;
		compactedParts: ToolPart[];
		pruningDataByWorkspace: Map<string, PruningSessionData>;
	} | undefined> {
		const checked = new Map<string, string>();
		const banned = new Set<string>();
		const partsByFile = new Map<string, ToolPart[]>();
		const compactedParts: ToolPart[] = [];
		const pruningDataByWorkspace = new Map<string, PruningSessionData>();
		const effectiveSessionId = this.getEffectiveSessionId();
		const [sessionToolPartUris, legacyToolPartUris] = await Promise.all([
			vscode.workspace.findFiles(
				`**/.contexty/sessions/${effectiveSessionId}/tool-parts.json`,
				'**/node_modules/**'
			),
			vscode.workspace.findFiles('**/.contexty/tool-parts.json', '**/node_modules/**')
		]);
		const sessionWorkspaceRoots = new Set(
			sessionToolPartUris.map((uri) => this.getWorkspaceRootFromPartsUri(uri))
		);
		const toolPartUris = [
			...sessionToolPartUris,
			...legacyToolPartUris.filter(
				(uri) =>
					!sessionWorkspaceRoots.has(this.getWorkspaceRootFromPartsUri(uri)) &&
					!sessionToolPartUris.some((sessionUri) => sessionUri.fsPath === uri.fsPath)
			)
		];

		for (const partsUri of toolPartUris) {
			const workspaceRoot = this.getWorkspaceRootFromPartsUri(partsUri);
			const pruningData = await loadPruningHistory(workspaceRoot, effectiveSessionId);
			if (pruningData) {
				pruningDataByWorkspace.set(workspaceRoot, pruningData);
			}
			const toolIdList = new Set<string>(pruningData?.prune?.toolIdList ?? []);
			const contextDirUri = vscode.Uri.file(path.dirname(partsUri.fsPath));
			const banUri = vscode.Uri.joinPath(contextDirUri, 'tool-parts.blacklist.json');
			let localBlacklist = new Set<string>();
			try {
				const banRaw = await vscode.workspace.fs.readFile(banUri);
				const banParsed = JSON.parse(Buffer.from(banRaw).toString('utf8')) as { ids?: unknown };
				if (Array.isArray(banParsed.ids)) {
					for (const id of banParsed.ids) {
						if (typeof id === 'string') {
							banned.add(id);
							localBlacklist.add(id);
						}
					}
				}
			} catch {
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
				return undefined;
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
				if (localBlacklist.has(id) || banned.has(id)) {
					continue;
				}
				const output = typeof state?.output === 'string' ? state.output : '';
				if (output.includes('<type>directory</type>')) {
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
				const list = partsByFile.get(key) ?? [];
				list.push(toolPart);
				partsByFile.set(key, list);
				if (toolPart.state.time?.compacted === true && toolIdList.has(toolPart.callID)) {
					compactedParts.push(toolPart);
				}
			}
		}

		return { checked, banned, partsByFile, compactedParts, pruningDataByWorkspace };
	}

	private applySnapshot(snapshot: {
		checked: Map<string, string>;
		banned: Set<string>;
		partsByFile: Map<string, ToolPart[]>;
		compactedParts: ToolPart[];
		pruningDataByWorkspace: Map<string, PruningSessionData>;
	}): void {
		this.checked = snapshot.checked;
		this.banned = snapshot.banned;
		this.partsByFile = snapshot.partsByFile;
		this.compactedParts = snapshot.compactedParts;
		this.pruningDataByWorkspace = snapshot.pruningDataByWorkspace;
	}

	private getPartTokens(part: ToolPart, countedBlocks?: Set<number>): number {
		if (part.state.time?.compacted) {
			for (const block of this.getPruningBlocksForPart(part)) {
				if (block.summaryTokens > 0) {
					if (countedBlocks?.has(block.blockId)) {
						return 0;
					}
					countedBlocks?.add(block.blockId);
					return block.summaryTokens;
				}
			}
			return 0;
		}

		const output = typeof part.state.output === 'string' ? part.state.output : '';
		return Math.round(output.length / 4);
	}

	private getEffectiveSessionId(): string {
		return this.currentSessionId ?? this.sessionId;
	}

	getSessionId(): string | undefined {
		return this.getEffectiveSessionId();
	}

	private getContextDirUri(rootUri: vscode.Uri): vscode.Uri {
		return vscode.Uri.joinPath(rootUri, '.contexty', 'sessions', this.getEffectiveSessionId());
	}

	private getPartsUri(rootUri: vscode.Uri): vscode.Uri {
		return vscode.Uri.joinPath(this.getContextDirUri(rootUri), 'tool-parts.json');
	}

	private getBanUri(rootUri: vscode.Uri): vscode.Uri {
		return vscode.Uri.joinPath(this.getContextDirUri(rootUri), 'tool-parts.blacklist.json');
	}

	private getWorkspaceRootFromPartsUri(partsUri: vscode.Uri): string {
		const sessionMarker = `${path.sep}.contexty${path.sep}sessions${path.sep}`;
		const sessionIndex = partsUri.fsPath.indexOf(sessionMarker);
		if (sessionIndex >= 0) {
			return partsUri.fsPath.slice(0, sessionIndex);
		}
		return path.dirname(path.dirname(partsUri.fsPath));
	}

	private getPruningBlocksForPart(part: ToolPart): CompressionBlockView[] {
		const filePath = part.state.input?.filePath;
		if (typeof filePath !== 'string') {
			return [];
		}

		const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath));
		if (!workspaceFolder) {
			return [];
		}

		return this.pruningDataByWorkspace.get(workspaceFolder.uri.fsPath)?.blocks ?? [];
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
