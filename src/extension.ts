import * as vscode from 'vscode';

import { MirrorExplorerProvider, MirrorNode } from './mirrorExplorer';
import { MirrorState } from './state';
import { SelectionLensProvider } from './selectionLens';
import { MirrorContextHighlights } from './contextHighlights';

export function activate(context: vscode.ExtensionContext) {
	const workspaceFolders = vscode.workspace.workspaceFolders;
	const state = new MirrorState(context.workspaceState, workspaceFolders);
	const provider = new MirrorExplorerProvider(state, context.subscriptions);
	const selectionLens = new SelectionLensProvider();
	const highlights = new MirrorContextHighlights(state);

	const treeView = vscode.window.createTreeView('kciMirror.explorer', {
		treeDataProvider: provider,
		showCollapseAll: true
	});
	context.subscriptions.push(treeView, highlights);

	context.subscriptions.push(
		vscode.languages.registerCodeLensProvider({ scheme: 'file' }, selectionLens),
		vscode.window.onDidChangeTextEditorSelection((event) => {
			if (event.textEditor.document.uri.scheme !== 'file') {
				return;
			}
			selectionLens.updateSelection(event.textEditor.document.uri, event.selections[0]);
		})
	);

	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(() => {
			highlights.refreshAll();
		}),
		vscode.window.onDidChangeVisibleTextEditors(() => {
			highlights.refreshAll();
		}),
		vscode.commands.registerCommand('kciMirror.refresh', () => {
			provider.refresh();
			highlights.refreshAll();
		}),
		vscode.commands.registerCommand(
			'kciMirror.addSelectionToContext',
			async (uri: vscode.Uri, selection: vscode.Selection) => {
				const doc = await vscode.workspace.openTextDocument(uri);
				await state.addSelectionPart(doc, selection);
				selectionLens.clearSelection(uri);
				provider.refresh();
				highlights.refreshAll();
			}
		),
		vscode.commands.registerCommand('kciMirror.removePart', async (node: MirrorNode | undefined) => {
			if (!node || node.type !== 'part' || !node.partId) {
				return;
			}
			await state.banPart(node.partId);
			provider.refresh();
			highlights.refreshAll();
		})
	);

	highlights.refreshAll();
}

// This method is called when your extension is deactivated
export function deactivate() {}
