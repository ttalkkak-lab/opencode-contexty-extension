import * as vscode from 'vscode';
import { ContextState } from './state';
import {
	getACPMChildren,
	getACPMTreeItem,
	isACPMNode,
	parsePermissionsFile,
	type ACPMNode,
	type PermissionsFile
} from './acpmNodes';

export type ContextNodeType = 'root' | 'dir' | 'file' | 'part';

export type ContextNode = {
	type: ContextNodeType;
	uri: vscode.Uri;
	label: string;
	partId?: string;
	tooltip?: string;
	partTruncated?: boolean;
} | ACPMNode;

export class ContextDragAndDropController implements vscode.TreeDragAndDropController<ContextNode> {
	dropMimeTypes = ['application/vnd.code.tree.contexty.hscmm.explorer', 'text/uri-list'];
	dragMimeTypes = [];

	constructor(private readonly state: ContextState, private readonly provider: ContextExplorerProvider) { }

	async handleDrop(target: ContextNode | undefined, dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): Promise<void> {
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

	handleDrag(source: ContextNode[], dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): void {
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

	getTreeItem(node: ContextNode): vscode.TreeItem {
		if (isACPMNode(node)) {
			return getACPMTreeItem(node);
		}

		const partCount = node.type === 'file' ? this.state.getPartCountForFile(node.uri) : 0;

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
			item.iconPath = new vscode.ThemeIcon(node.partTruncated === false ? 'symbol-file' : 'symbol-snippet');
		}

		if (node.type === 'part') {
			item.tooltip = node.tooltip ?? node.label;
			item.command = {
				command: 'vscode.open',
				title: 'Open',
				arguments: [node.uri]
			};
		}

		// Checkbox is the primary UI signal; keep labels clean.

		return item;
	}

	async getChildren(node?: ContextNode): Promise<ContextNode[]> {
		if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
			return [];
		}

		if (node && isACPMNode(node)) {
			return getACPMChildren(node);
		}

		if (!node) {
			const permissionsFile = await this.readACPMPermissionsFile();
			const workspaceRoot = vscode.workspace.workspaceFolders.find((folder) => folder.uri.scheme === 'file')?.uri;
			const acpmRoot: ACPMNode | undefined = workspaceRoot
				? {
					type: 'acpm-root',
					uri: workspaceRoot,
					label: 'ACPM',
					permissionsFile
				}
				: undefined;

			await this.state.refreshFromDisk();
			const roots = this.state.getRootsWithParts();
			if (roots.length === 1) {
				const children = this.state.getChildrenForPath(roots[0].uri);
				return [
					...(acpmRoot ? [acpmRoot] : []),
					...children.dirs.map((dir) => ({ type: 'dir' as const, uri: dir.uri, label: dir.label })),
					...children.files.map((file) => ({ type: 'file' as const, uri: file.uri, label: file.label }))
				];
			}
			if (acpmRoot) {
				return [
					acpmRoot,
					...roots.map((root) => ({
						type: 'root' as const,
						uri: root.uri,
						label: root.label
					}))
				];
			}
			return roots.map((root) => ({
				type: 'root' as const,
				uri: root.uri,
				label: root.label
			}));
		}

		if (node.type === 'file') {
			const parts = this.state.getPartsForFile(node.uri);
			return parts.map((part) => ({
				type: 'part',
				uri: node.uri,
				label: part.label,
				partId: part.id,
				tooltip: part.tooltip,
				partTruncated: part.truncated
			}));
		}

		const children = this.state.getChildrenForPath(node.uri);
		return [
			...children.dirs.map((dir) => ({ type: 'dir' as const, uri: dir.uri, label: dir.label })),
			...children.files.map((file) => ({ type: 'file' as const, uri: file.uri, label: file.label }))
		];
	}

	private async readACPMPermissionsFile(): Promise<PermissionsFile> {
		const workspaceRoot = vscode.workspace.workspaceFolders?.find((folder) => folder.uri.scheme === 'file')?.uri;
		if (!workspaceRoot) {
			return { version: 1, presets: [] };
		}

		try {
			const fileUri = vscode.Uri.joinPath(workspaceRoot, '.contexty', 'permissions.json');
			const raw = await vscode.workspace.fs.readFile(fileUri);
			const parsed = JSON.parse(Buffer.from(raw).toString('utf8'));
			return parsePermissionsFile(parsed);
		} catch {
			return { version: 1, presets: [] };
		}
	}
}
