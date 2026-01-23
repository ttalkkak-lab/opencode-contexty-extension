import * as path from 'path';
import * as vscode from 'vscode';
import { MirrorState } from './state';

export type MirrorNodeType = 'root' | 'dir' | 'file';

export type MirrorNode = {
	type: MirrorNodeType;
	uri: vscode.Uri;
	label: string;
};

function sortLikeExplorer(a: { name: string; isDir: boolean }, b: { name: string; isDir: boolean }): number {
	// Folders first
	if (a.isDir !== b.isDir) {
		return a.isDir ? -1 : 1;
	}
	return a.name.localeCompare(b.name);
}

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
		const isChecked = this.state.isChecked(node.uri);

		const collapsibleState =
			node.type === 'file'
				? vscode.TreeItemCollapsibleState.None
				: node.type === 'root'
					? vscode.TreeItemCollapsibleState.Expanded
					: vscode.TreeItemCollapsibleState.Collapsed;

		const itemLabel =
			node.type === 'root'
				? node.label
				: node.type === 'file'
					? `${node.label}  ${isChecked ? '[x]' : '[ ]'}`
					: node.label;
		const item = new vscode.TreeItem(itemLabel, collapsibleState);
		item.resourceUri = node.uri;
		if (node.type === 'root') {
			item.contextValue = 'kciMirror.root';
		} else {
			item.contextValue =
				node.type === 'file'
					? `kciMirror.file.${isChecked ? 'checked' : 'unchecked'}`
					: 'kciMirror.dir';
		}

		if (node.type === 'file') {
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
			return vscode.workspace.workspaceFolders.map((wf) => ({
				type: 'root',
				uri: wf.uri,
				label: wf.name
			}));
		}

		if (node.type === 'file') {
			return [];
		}

		let entries: [string, vscode.FileType][];
		try {
			entries = await vscode.workspace.fs.readDirectory(node.uri);
		} catch {
			return [];
		}

		const children = entries
			.map(([name, fileType]) => {
				const uri = vscode.Uri.joinPath(node.uri, name);
				const isDir = (fileType & vscode.FileType.Directory) === vscode.FileType.Directory;
				const type: MirrorNodeType = isDir ? 'dir' : 'file';
				return {
					name,
					isDir,
					node: {
						type,
						uri,
						label: name
					} satisfies MirrorNode
				};
			})
			.sort(sortLikeExplorer)
			.map(({ node: child }) => child);

		return children;
	}
}
