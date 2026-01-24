import * as vscode from 'vscode';
import { MirrorState } from './state';

export type MirrorNodeType = 'root' | 'dir' | 'file' | 'part';

export type MirrorNode = {
	type: MirrorNodeType;
	uri: vscode.Uri;
	label: string;
	partId?: string;
	tooltip?: string;
};

export class MirrorExplorerProvider implements vscode.TreeDataProvider<MirrorNode> {
	private readonly treeChangeEmitter = new vscode.EventEmitter<MirrorNode | undefined | null | void>();
	readonly onDidChangeTreeData = this.treeChangeEmitter.event;

	private refreshTimer: NodeJS.Timeout | undefined;

	constructor(
		private readonly state: MirrorState,
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

	getTreeItem(node: MirrorNode): vscode.TreeItem {
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
			item.contextValue = 'kciMirror.root';
		} else if (node.type === 'part') {
			item.contextValue = 'kciMirror.part';
		} else {
			item.contextValue = node.type === 'file' ? 'kciMirror.file' : 'kciMirror.dir';
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
			item.iconPath = new vscode.ThemeIcon('symbol-snippet');
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

	async getChildren(node?: MirrorNode): Promise<MirrorNode[]> {
		if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
			return [];
		}

		if (!node) {
			await this.state.refreshFromDisk();
			const roots = this.state.getRootsWithParts();
			if (roots.length === 1) {
				const children = this.state.getChildrenForPath(roots[0].uri);
				return [
					...children.dirs.map((dir) => ({ type: 'dir' as const, uri: dir.uri, label: dir.label })),
					...children.files.map((file) => ({ type: 'file' as const, uri: file.uri, label: file.label }))
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
				tooltip: part.tooltip
			}));
		}

		const children = this.state.getChildrenForPath(node.uri);
		return [
			...children.dirs.map((dir) => ({ type: 'dir' as const, uri: dir.uri, label: dir.label })),
			...children.files.map((file) => ({ type: 'file' as const, uri: file.uri, label: file.label }))
		];
	}
}
