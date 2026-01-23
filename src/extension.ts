import * as vscode from 'vscode';

import { MirrorExplorerProvider, MirrorNode } from './mirrorExplorer';
import { MirrorState } from './state';

export function activate(context: vscode.ExtensionContext) {
	const workspaceFolders = vscode.workspace.workspaceFolders;
	const state = new MirrorState(context.workspaceState, workspaceFolders);
	const provider = new MirrorExplorerProvider(state, context.subscriptions);

	const treeView = vscode.window.createTreeView('kciMirror.explorer', {
		treeDataProvider: provider,
		showCollapseAll: true
	});
	context.subscriptions.push(treeView);

	context.subscriptions.push(
		vscode.commands.registerCommand('kciMirror.refresh', () => {
			provider.refresh();
		}),
		vscode.commands.registerCommand('kciMirror.check', async (node: MirrorNode | undefined) => {
			// Files only. Folder check UI/behavior intentionally disabled.
			if (!node || node.type !== 'file') {
				return;
			}
			await state.setChecked(node.uri, true);
			provider.refresh();
		}),
		vscode.commands.registerCommand('kciMirror.uncheck', async (node: MirrorNode | undefined) => {
			// Files only. Folder check UI/behavior intentionally disabled.
			if (!node || node.type !== 'file') {
				return;
			}
			await state.setChecked(node.uri, false);
			provider.refresh();
		})
	);
}

// This method is called when your extension is deactivated
export function deactivate() {}
