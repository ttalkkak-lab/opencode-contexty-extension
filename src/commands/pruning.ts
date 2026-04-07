import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';

type PruningToolEntry = {
	callID?: string;
	callId?: string;
	[key: string]: unknown;
};

type PruningBlockEntry = {
	blockId?: number;
	active?: boolean;
	[key: string]: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

type PruningStateFile = {
	prune?: {
		tools?: PruningToolEntry[];
		blocks?: PruningBlockEntry[];
		[key: string]: unknown;
	};
	blocks?: PruningBlockEntry[];
	[key: string]: unknown;
};

function pruningStatePath(workspaceRoot: string, sessionId: string): string {
	return path.join(workspaceRoot, '.contexty', 'sessions', sessionId, 'pruning-state.json');
}

async function readPruningState(filePath: string): Promise<PruningStateFile | null> {
	try {
		const raw = await fs.readFile(filePath, 'utf8');
		return JSON.parse(raw) as PruningStateFile;
	} catch {
		return null;
	}
}

async function writePruningState(filePath: string, state: PruningStateFile): Promise<void> {
	await fs.mkdir(path.dirname(filePath), { recursive: true });
	await fs.writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function getPruneContainer(state: PruningStateFile): Record<string, unknown> {
	if (state.prune && typeof state.prune === 'object') {
		return state.prune as Record<string, unknown>;
	}

	state.prune = {};
	return state.prune;
}

function getTools(state: PruningStateFile): PruningToolEntry[] {
	const prune = getPruneContainer(state);
	const tools = prune.tools;
	return Array.isArray(tools) ? (tools as PruningToolEntry[]) : [];
}

function getBlocks(state: PruningStateFile): PruningBlockEntry[] {
	const prune = getPruneContainer(state);
	const blocks = prune.blocks ?? state.blocks;
	return Array.isArray(blocks) ? (blocks as PruningBlockEntry[]) : [];
}

function getToolCallId(entry: PruningToolEntry): string {
	return typeof entry.callID === 'string' ? entry.callID : typeof entry.callId === 'string' ? entry.callId : '';
}

function resolveToolEntry(nodeOrEntry: unknown): PruningToolEntry | undefined {
	if (!isRecord(nodeOrEntry)) {
		return undefined;
	}
	if (typeof nodeOrEntry.callID === 'string' || typeof nodeOrEntry.callId === 'string') {
		return nodeOrEntry as PruningToolEntry;
	}
	if (isRecord(nodeOrEntry.entry) && (typeof nodeOrEntry.entry.callID === 'string' || typeof nodeOrEntry.entry.callId === 'string')) {
		return nodeOrEntry.entry as PruningToolEntry;
	}
	return undefined;
}

function resolveBlockEntry(nodeOrBlock: unknown): PruningBlockEntry | undefined {
	if (!isRecord(nodeOrBlock)) {
		return undefined;
	}
	if (typeof nodeOrBlock.blockId === 'number') {
		return nodeOrBlock as PruningBlockEntry;
	}
	if (isRecord(nodeOrBlock.block) && typeof nodeOrBlock.block.blockId === 'number') {
		return nodeOrBlock.block as PruningBlockEntry;
	}
	return undefined;
}

async function refreshPruningView(): Promise<void> {
	await vscode.commands.executeCommand('contexty.hscmm.refresh');
}

export function registerPruningCommands(context: vscode.ExtensionContext, workspaceRoot: string | undefined, getSessionId: () => string | undefined): void {
	context.subscriptions.push(
		vscode.commands.registerCommand('contexty.pruning.restoreEntry', async (entry?: unknown) => {
			const sessionId = getSessionId();
			if (!workspaceRoot || !sessionId || !entry) {
				return;
			}

			const resolvedEntry = resolveToolEntry(entry);
			const callId = resolvedEntry ? getToolCallId(resolvedEntry) : '';
			if (!callId) {
				return;
			}

			const filePath = pruningStatePath(workspaceRoot, sessionId);
			const state = await readPruningState(filePath);
			if (!state) {
				return;
			}

			const tools = getTools(state);
			const nextTools = tools.filter((tool) => getToolCallId(tool) !== callId);
			if (nextTools.length === tools.length) {
				return;
			}

			getPruneContainer(state).tools = nextTools;
			await writePruningState(filePath, state);
			await refreshPruningView();
		}),
		vscode.commands.registerCommand('contexty.pruning.restoreAll', async () => {
			const sessionId = getSessionId();
			if (!workspaceRoot || !sessionId) {
				return;
			}

			const filePath = pruningStatePath(workspaceRoot, sessionId);
			const state = await readPruningState(filePath);
			if (!state) {
				return;
			}

			const prune = getPruneContainer(state);
			if (!Array.isArray(prune.tools) || prune.tools.length === 0) {
				return;
			}

			prune.tools = [];
			await writePruningState(filePath, state);
			await refreshPruningView();
		}),
		vscode.commands.registerCommand('contexty.pruning.decompressBlock', async (block?: unknown) => {
			const sessionId = getSessionId();
			if (!workspaceRoot || !sessionId || !block) {
				return;
			}

			const resolvedBlock = resolveBlockEntry(block);
			const blockId = typeof resolvedBlock?.blockId === 'number' ? resolvedBlock.blockId : Number.NaN;
			if (!Number.isFinite(blockId)) {
				return;
			}

			const filePath = pruningStatePath(workspaceRoot, sessionId);
			const state = await readPruningState(filePath);
			if (!state) {
				return;
			}

			const blocks = getBlocks(state);
			let changed = false;
			const nextBlocks = blocks.map((item) => {
				if (item.blockId !== blockId) {
					return item;
				}
				changed = true;
				return { ...item, active: false };
			});

			if (!changed) {
				return;
			}

			getPruneContainer(state).blocks = nextBlocks;
			if (Array.isArray(state.blocks)) {
				state.blocks = nextBlocks;
			}
			await writePruningState(filePath, state);
			await refreshPruningView();
		})
	);
}
