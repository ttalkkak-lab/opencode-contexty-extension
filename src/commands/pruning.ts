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
		messages?: {
			blocksById?: unknown[];
			[key: string]: unknown;
		};
		[key: string]: unknown;
	};
	blocks?: PruningBlockEntry[];
	stats?: { totalPruneTokens?: number; [key: string]: unknown };
	toolParameters?: unknown[];
	[key: string]: unknown;
};

function pruningStatePath(workspaceRoot: string, sessionId: string): string {
	return path.join(workspaceRoot, '.contexty', 'sessions', sessionId, 'pruning-state.json');
}

export async function readPruningState(filePath: string): Promise<PruningStateFile | null> {
	try {
		const raw = await fs.readFile(filePath, 'utf8');
		return JSON.parse(raw) as PruningStateFile;
	} catch {
		return null;
	}
}

export async function writePruningState(filePath: string, state: PruningStateFile): Promise<void> {
	await fs.mkdir(path.dirname(filePath), { recursive: true });
	await fs.writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

export function getPruneContainer(state: PruningStateFile): Record<string, unknown> {
	if (state.prune && typeof state.prune === 'object') {
		return state.prune as Record<string, unknown>;
	}

	state.prune = {};
	return state.prune;
}

export function getTools(state: PruningStateFile): PruningToolEntry[] {
	const prune = getPruneContainer(state);
	const tools = prune.tools;
	return Array.isArray(tools) ? (tools as PruningToolEntry[]) : [];
}

export function getBlocks(state: PruningStateFile): PruningBlockEntry[] {
	const prune = getPruneContainer(state);
	const messages = isRecord(prune.messages) ? prune.messages : null;

	if (messages && Array.isArray(messages.blocksById)) {
		const result: PruningBlockEntry[] = [];
		for (const item of messages.blocksById) {
			if (Array.isArray(item) && item.length === 2 && isRecord(item[1])) {
				result.push(item[1] as PruningBlockEntry);
			}
		}
		if (result.length > 0) {
			return result;
		}
	}

	const blocks = prune.blocks ?? state.blocks;
	return Array.isArray(blocks) ? (blocks as PruningBlockEntry[]) : [];
}

function getToolCallId(entry: PruningToolEntry): string {
	if (Array.isArray(entry) && typeof entry[0] === 'string') {
		return entry[0];
	}
	return typeof entry.callID === 'string' ? entry.callID : typeof entry.callId === 'string' ? entry.callId : '';
}

export function resolveToolEntry(nodeOrEntry: unknown): PruningToolEntry | undefined {
	if (Array.isArray(nodeOrEntry) && nodeOrEntry.length === 2 && typeof nodeOrEntry[0] === 'string') {
		return { callId: nodeOrEntry[0] } as PruningToolEntry;
	}
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

export function resolveBlockEntry(nodeOrBlock: unknown): PruningBlockEntry | undefined {
	if (Array.isArray(nodeOrBlock) && nodeOrBlock.length === 2 && typeof nodeOrBlock[0] === 'number') {
		return nodeOrBlock[1] as PruningBlockEntry;
	}
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

			let changed = false;
			const prune = getPruneContainer(state);
			const messages = isRecord(prune.messages) ? prune.messages : null;
			if (messages && Array.isArray(messages.blocksById)) {
				for (const item of messages.blocksById) {
					if (Array.isArray(item) && item.length === 2 && isRecord(item[1])) {
						const entry = item[1] as PruningBlockEntry;
						if (entry.blockId === blockId && entry.active) {
							entry.active = false;
							changed = true;
							break;
						}
					}
				}
			}

			if (!changed) {
				const blocks = getBlocks(state);
				for (const item of blocks) {
					if (item.blockId === blockId && item.active) {
						item.active = false;
						changed = true;
						break;
					}
				}
			}

			if (!changed) {
				return;
			}

			if (Array.isArray(prune.blocks)) {
				prune.blocks = getBlocks(state);
			}
			if (Array.isArray(state.blocks)) {
				state.blocks = getBlocks(state);
			}
			await writePruningState(filePath, state);
			await refreshPruningView();
		})
	);
}
