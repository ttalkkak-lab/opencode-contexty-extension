import * as path from 'path';
import * as vscode from 'vscode';
import { ContextState, type CompressionBlockView } from './state';

export type ContextNodeType = 'root' | 'dir' | 'file' | 'part';

export type ContextNode = {
	type: ContextNodeType;
	uri: vscode.Uri;
	label: string;
	partId?: string;
	callId?: string;
	tool?: string;
	sourcePath?: string;
	tooltip?: string;
	partTruncated?: boolean;
	compacted?: boolean;
	compactedCount?: number;
	tokens?: number;
	percentage?: number;
	children?: ContextNode[];
};

type RawContextPart = {
	id?: string;
	callID?: string;
	state?: {
		input?: { filePath?: string };
		time?: { start?: number; compacted?: boolean };
	};
};

export class ContextDragAndDropController implements vscode.TreeDragAndDropController<ContextNode> {
	dropMimeTypes = ['application/vnd.code.tree.contexty.hscmm.explorer', 'text/uri-list'];
	dragMimeTypes = [];

	constructor(private readonly state: ContextState, private readonly provider: ContextExplorerProvider) { }

	async handleDrop(_target: ContextNode | undefined, dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): Promise<void> {
		const uriList = dataTransfer.get('text/uri-list');
		if (!uriList) {
			return;
		}

		const uris: vscode.Uri[] = [];
		const entries = await uriList.value;
		if (typeof entries === 'string') {
			const lines = entries.split(/\r?\n/).filter(line => line.trim().length > 0);
			for (const line of lines) {
				try {
					uris.push(vscode.Uri.parse(line));
				} catch { }
			}
		}

		if (uris.length === 0) {
			return;
		}

		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: "Adding to Context...",
			cancellable: false
		}, async () => {
			for (const uri of uris) {
				if (token.isCancellationRequested) {
					break;
				}
				if (uri.scheme !== 'file') {
					continue;
				}

				try {
					const stat = await vscode.workspace.fs.stat(uri);
					if (stat.type === vscode.FileType.File) {
						await this.state.addFilePart(uri);
					} else if (stat.type === vscode.FileType.Directory) {
						const files = await vscode.workspace.findFiles(
							new vscode.RelativePattern(uri, '**/*'),
							'**/node_modules/**'
						);
						for (const file of files) {
							try {
								const fileStat = await vscode.workspace.fs.stat(file);
								if (fileStat.type === vscode.FileType.File) {
									await this.state.addFilePart(file);
								}
							} catch { }
						}
					}
				} catch { }
			}
		});

		this.provider.refresh();
	}

	handleDrag(_source: ContextNode[], _dataTransfer: vscode.DataTransfer, _token: vscode.CancellationToken): void {
	}
}

export class ContextExplorerProvider implements vscode.TreeDataProvider<ContextNode> {
	private readonly treeChangeEmitter = new vscode.EventEmitter<ContextNode | undefined | null | void>();
	readonly onDidChangeTreeData = this.treeChangeEmitter.event;

	private refreshTimer: NodeJS.Timeout | undefined;

	constructor(
		private readonly state: ContextState,
		private readonly disposables: vscode.Disposable[]
	) {
		const watcher = vscode.workspace.createFileSystemWatcher('**/*');
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

	private getCompactedCallIds(): Set<string> {
		return new Set(
			this.state.compactedParts
				.map((part) => part.callID)
				.filter((callID): callID is string => typeof callID === 'string' && callID.length > 0)
		);
	}

	private getRawPartsForFile(uri: vscode.Uri): RawContextPart[] {
		const rawState = this.state as unknown as { partsByFile?: Map<string, RawContextPart[]> };
		const parts = rawState.partsByFile?.get(uri.toString());
		if (!Array.isArray(parts)) {
			return [];
		}
		return [...parts].sort((a, b) => {
			const aTime = a.state?.time?.start ?? 0;
			const bTime = b.state?.time?.start ?? 0;
			if (aTime !== bTime) {
				return aTime - bTime;
			}
			return (a.id ?? '').localeCompare(b.id ?? '');
		});
	}

	private isCompactedDescendant(node: ContextNode, filePath: string): boolean {
		const nodePath = node.uri.fsPath.toLowerCase();
		const normalizedFilePath = filePath.toLowerCase();
		if (node.type === 'file') {
			return normalizedFilePath === nodePath || normalizedFilePath.startsWith(`${nodePath}${path.sep}`);
		}
		return normalizedFilePath.startsWith(`${nodePath}${path.sep}`);
	}

	private getCompactedCountForNode(node: ContextNode, compactedCallIds: Set<string>): number {
		if (node.type !== 'file' && node.type !== 'dir' && node.type !== 'root') {
			return 0;
		}

		const rawState = this.state as unknown as { partsByFile?: Map<string, RawContextPart[]> };
		const partsByFile = rawState.partsByFile;
		if (!partsByFile) {
			return 0;
		}

		let count = 0;
		for (const parts of partsByFile.values()) {
			for (const part of parts) {
				const filePath = part.state?.input?.filePath;
				const callID = part.callID;
				if (typeof filePath !== 'string' || typeof callID !== 'string') {
					continue;
				}
				if (!compactedCallIds.has(callID)) {
					continue;
				}
				if (this.isCompactedDescendant(node, filePath)) {
					count += 1;
				}
			}
		}

		return count;
	}

	private getCompressionBlockForCallId(callId?: string): CompressionBlockView | undefined {
		if (typeof callId !== 'string' || callId.length === 0) {
			return undefined;
		}

		const rawState = this.state as unknown as { pruningData?: { blocks?: CompressionBlockView[] } };
		return rawState.pruningData?.blocks?.find((block) => block.effectiveToolIds.includes(callId));
	}

	getTreeItem(node: ContextNode): vscode.TreeItem {
		const compactedCallIds = this.getCompactedCallIds();
		const partCount = node.type === 'file' ? this.state.getPartCountForFile(node.uri) : 0;
		const compactedCount = this.getCompactedCountForNode(node, compactedCallIds);

		const collapsibleState =
			node.type === 'file'
				? partCount > 0
					? vscode.TreeItemCollapsibleState.Collapsed
					: vscode.TreeItemCollapsibleState.None
				: node.type === 'part'
					? vscode.TreeItemCollapsibleState.None
				: node.type === 'root'
					? vscode.TreeItemCollapsibleState.Expanded
					: vscode.TreeItemCollapsibleState.Collapsed;

		const itemLabel =
			node.type === 'root'
				? node.label
				: node.label;
		const item = new vscode.TreeItem(itemLabel, collapsibleState);
		item.resourceUri = node.uri;
		if (node.type === 'root') {
			item.contextValue = 'contexty.hscmm.root';
		} else if (node.type === 'part') {
			item.contextValue = 'contexty.hscmm.part';
		} else {
			item.contextValue = node.type === 'file' ? 'contexty.hscmm.file' : 'contexty.hscmm.dir';
		}

		if (node.type === 'file') {
			item.iconPath = new vscode.ThemeIcon('file');
			item.command = {
				command: 'vscode.open',
				title: 'Open',
				arguments: [node.uri]
			};
		}
		if (node.type === 'dir') {
			item.iconPath = new vscode.ThemeIcon('folder');
		}
		if (node.type === 'part') {
			item.iconPath = node.compacted
				? new vscode.ThemeIcon('circle-slash')
				: new vscode.ThemeIcon(node.partTruncated === false ? 'symbol-file' : 'symbol-snippet');
			if (node.compacted) {
				item.description = '(compressed)';
			}
		}

		if (node.type === 'part') {
			const compressionBlock = node.compacted ? this.getCompressionBlockForCallId(node.callId) : undefined;
			item.tooltip = node.tooltip ?? node.label;
			if (compressionBlock) {
				item.tooltip = `${item.tooltip}\nCompressed: Original: ${compressionBlock.compressedTokens.toLocaleString()} tokens → Summary: ${compressionBlock.summaryTokens.toLocaleString()} tokens`;
			}
			item.command = {
				command: 'vscode.open',
				title: 'Open',
				arguments: [node.uri]
			};
		}

		if (node.percentage !== undefined && node.tokens !== undefined && node.type !== 'part') {
			const pct = node.percentage;
			const tok = node.tokens >= 1000 ? `${(node.tokens / 1000).toFixed(1)}k` : `${node.tokens}`;
			item.description = `${pct.toFixed(1)}%  ~${tok}`;
			item.tooltip = `${node.label}\n~${node.tokens.toLocaleString()} tokens • ${pct.toFixed(1)}% of context`;
		}

		if (compactedCount > 0 && node.type !== 'part') {
			const compactedDescription = `(${compactedCount} compressed)`;
			item.description = item.description ? `${item.description} • ${compactedDescription}` : compactedDescription;
		}

		return item;
	}

	async getChildren(node?: ContextNode): Promise<ContextNode[]> {
		if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
			return [];
		}

		const totalTokens = this.state.getTotalTokens();

		if (!node) {
			if (!this.state.getSessionId()) {
				return [{ type: 'root' as const, uri: vscode.Uri.parse(''), label: 'No active session', tooltip: 'Select a session to view context' }];
			}
			await this.state.refreshFromDisk();
			const roots = this.state.getRootsWithParts();
			if (roots.length === 1) {
				const children = this.state.getChildrenForPath(roots[0].uri);
				return [
					...children.dirs.map((dir) => {
						const tokens = this.state.getNodeTokens(dir.uri, 'dir');
						return { type: 'dir' as const, uri: dir.uri, label: dir.label, tokens, percentage: totalTokens > 0 ? (tokens / totalTokens) * 100 : 0 };
					}),
					...children.files.map((file) => {
						const tokens = this.state.getNodeTokens(file.uri, 'file');
						return { type: 'file' as const, uri: file.uri, label: file.label, tokens, percentage: totalTokens > 0 ? (tokens / totalTokens) * 100 : 0 };
					})
				];
			}
			return [
				...roots.map((root) => {
					const tokens = this.state.getNodeTokens(root.uri, 'root');
					return {
						type: 'root' as const,
						uri: root.uri,
						label: root.label,
						tokens,
						percentage: totalTokens > 0 ? (tokens / totalTokens) * 100 : 0
					};
				})
			];
		}

		if (node.type === 'file') {
			const parts = this.state.getPartsForFile(node.uri);
			const rawParts = this.getRawPartsForFile(node.uri);
			const compactedCallIds = this.getCompactedCallIds();
			return parts.map((part, index) => {
				const rawPart = rawParts[index];
				const callId = rawPart?.callID;
				return {
					type: 'part' as const,
					uri: node.uri,
					label: part.label,
					partId: part.id,
					callId,
					tooltip: part.tooltip,
					partTruncated: part.truncated,
					compacted: typeof callId === 'string' ? compactedCallIds.has(callId) : false
				};
			});
		}

		const children = this.state.getChildrenForPath(node.uri);
		return [
			...children.dirs.map((dir) => {
				const tokens = this.state.getNodeTokens(dir.uri, 'dir');
				return { type: 'dir' as const, uri: dir.uri, label: dir.label, tokens, percentage: totalTokens > 0 ? (tokens / totalTokens) * 100 : 0 };
			}),
			...children.files.map((file) => {
				const tokens = this.state.getNodeTokens(file.uri, 'file');
				return { type: 'file' as const, uri: file.uri, label: file.label, tokens, percentage: totalTokens > 0 ? (tokens / totalTokens) * 100 : 0 };
			})
		];
	}
}
