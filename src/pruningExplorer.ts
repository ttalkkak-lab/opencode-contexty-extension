import * as vscode from 'vscode';
import { loadPruningHistory, type CompressionBlockView, type PruningEntry, type PruningSessionData } from './state';

type PruningExplorerNodeType = 'root' | 'category' | 'dedup-entry' | 'error-entry' | 'block-entry';

export type PruningExplorerNode = {
	type: PruningExplorerNodeType;
	label: string;
	tooltip?: string;
	contextValue?: string;
	entry?: PruningEntry;
	block?: CompressionBlockView;
	children?: PruningExplorerNode[];
};

function formatTokenCount(value: number | undefined): string {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
		return '0';
	}
	return `${value.toLocaleString()} tokens`;
}

function formatSavings(block: CompressionBlockView): string {
	const saved = Math.max(0, block.compressedTokens - block.summaryTokens);
	return `${saved.toLocaleString()} saved`;
}

function buildDedupLabel(entry: PruningEntry): string {
	return `${entry.tool} • turn ${entry.turn} • ${formatTokenCount(entry.tokenCount)}`;
}

function buildErrorLabel(entry: PruningEntry): string {
	const error = entry.error?.trim() || 'Unknown error';
	return `${entry.tool} • turn ${entry.turn} • ${error}`;
}

function buildBlockLabel(block: CompressionBlockView): string {
	const status = block.active ? 'active' : 'inactive';
	return `${block.topic} • ${formatSavings(block)} • ${status}`;
}

function createEntryTooltip(entry: PruningEntry): string {
	const base = [`Tool: ${entry.tool}`, `Turn: ${entry.turn}`, `Reason: ${entry.reason}`];
	if (typeof entry.tokenCount === 'number') {
		base.push(`Tokens: ${entry.tokenCount.toLocaleString()}`);
	}
	if (entry.error) {
		base.push(`Error: ${entry.error}`);
	}
	return base.join('\n');
}

function createBlockTooltip(block: CompressionBlockView): string {
	return [
		`Topic: ${block.topic}`,
		`Block: #${block.blockId}`,
		`Active: ${block.active ? 'yes' : 'no'}`,
		`Saved: ${formatSavings(block)}`,
		`Summary tokens: ${block.summaryTokens.toLocaleString()}`,
		`Compressed tokens: ${block.compressedTokens.toLocaleString()}`,
		`Range: ${block.startId} → ${block.endId}`,
	].join('\n');
}

export class PruningExplorerProvider implements vscode.TreeDataProvider<PruningExplorerNode> {
	private readonly treeChangeEmitter = new vscode.EventEmitter<PruningExplorerNode | undefined | null | void>();
	readonly onDidChangeTreeData = this.treeChangeEmitter.event;

	private refreshTimer: NodeJS.Timeout | undefined;
	private sessionData: PruningSessionData | null = null;

	constructor(
		private readonly workspaceRoot: string | undefined,
		private readonly getSessionId: () => string | undefined,
		private readonly disposables: vscode.Disposable[],
	) {
		const watcher = vscode.workspace.createFileSystemWatcher('**/.contexty/sessions/*/pruning-state.json');
		this.disposables.push(
			watcher,
			watcher.onDidCreate(() => this.refreshSoon()),
			watcher.onDidChange(() => this.refreshSoon()),
			watcher.onDidDelete(() => this.refreshSoon())
		);
	}

	refresh(): void {
		this.treeChangeEmitter.fire();
	}

	private refreshSoon(): void {
		if (this.refreshTimer) {
			clearTimeout(this.refreshTimer);
		}
		this.refreshTimer = setTimeout(() => this.refresh(), 150);
	}

	private async ensureData(): Promise<PruningSessionData | null> {
		const sessionId = this.getSessionId();
		if (!this.workspaceRoot || !sessionId) {
			this.sessionData = null;
			return null;
		}

		this.sessionData = await loadPruningHistory(this.workspaceRoot, sessionId);
		return this.sessionData;
	}

	getTreeItem(node: PruningExplorerNode): vscode.TreeItem {
		const collapsibleState =
			node.type === 'root' || node.type === 'category'
				? vscode.TreeItemCollapsibleState.Collapsed
				: vscode.TreeItemCollapsibleState.None;
		const item = new vscode.TreeItem(node.label, collapsibleState);
		item.tooltip = node.tooltip ?? node.label;
		item.contextValue = node.contextValue;

		switch (node.type) {
			case 'root':
				item.iconPath = new vscode.ThemeIcon('filter');
				break;
			case 'category':
				item.iconPath = new vscode.ThemeIcon('list-tree');
				break;
			case 'dedup-entry':
				item.iconPath = new vscode.ThemeIcon('filter');
				break;
			case 'error-entry':
				item.iconPath = new vscode.ThemeIcon('warning');
				break;
			case 'block-entry':
				item.iconPath = new vscode.ThemeIcon('file-compressed');
				break;
		}

		if (node.type === 'block-entry' && node.block) {
			item.description = node.block.active ? 'active' : 'inactive';
		}

		return item;
	}

	async getChildren(node?: PruningExplorerNode): Promise<PruningExplorerNode[]> {
		const data = await this.ensureData();
		if (!data) {
			if (!this.getSessionId()) {
				return [{ type: 'root', label: 'No active session', tooltip: 'Select a session to view pruning history', contextValue: 'contexty.pruning.root' }];
			}
			return [{ type: 'root', label: 'No pruning history', tooltip: 'No pruning state has been saved yet', contextValue: 'contexty.pruning.root' }];
		}

		if (!node) {
			return [{ type: 'root', label: `Pruning History • ${data.sessionId}`, tooltip: `Session ${data.sessionId}`, contextValue: 'contexty.pruning.root' }];
		}

		if (node.type === 'root') {
			return [
				{
					type: 'category',
					label: `Deduplicated (${data.entries.filter((entry) => entry.reason === 'deduplication').length})`,
					tooltip: 'Deduplicated tool calls',
					contextValue: 'contexty.pruning.category',
					children: data.entries
						.filter((entry) => entry.reason === 'deduplication')
						.map((entry) => ({
							type: 'dedup-entry' as const,
							label: buildDedupLabel(entry),
							tooltip: createEntryTooltip(entry),
							contextValue: 'contexty.pruning.entry.deduplicated',
							entry,
						}))
				},
				{
					type: 'category',
					label: `Purged Errors (${data.entries.filter((entry) => entry.reason === 'purge-errors').length})`,
					tooltip: 'Purged error tool calls',
					contextValue: 'contexty.pruning.category',
					children: data.entries
						.filter((entry) => entry.reason === 'purge-errors')
						.map((entry) => ({
							type: 'error-entry' as const,
							label: buildErrorLabel(entry),
							tooltip: createEntryTooltip(entry),
							contextValue: 'contexty.pruning.entry.error',
							entry,
						}))
				},
				{
					type: 'category',
					label: `Compressed Blocks (${data.blocks.length})`,
					tooltip: 'Compression block history',
					contextValue: 'contexty.pruning.category',
					children: data.blocks.map((block) => ({
						type: 'block-entry' as const,
						label: buildBlockLabel(block),
						tooltip: createBlockTooltip(block),
						contextValue: block.active ? 'contexty.pruning.block.active' : 'contexty.pruning.block.inactive',
						block,
					}))
				}
			];
		}

		if (node.children) {
			return node.children;
		}

		return [];
	}
}
