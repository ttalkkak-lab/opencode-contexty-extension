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

	const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
	statusBarItem.command = 'kciMirror.addSelectionToContextWithCurrent';
	statusBarItem.text = '$(plus) Add to Context';
	statusBarItem.tooltip = 'Add current selection to context';
	context.subscriptions.push(statusBarItem);

	const updateStatusBar = () => {
		const editor = vscode.window.activeTextEditor;
		if (editor && !editor.selection.isEmpty) {
			statusBarItem.show();
		} else {
			statusBarItem.hide();
		}
	};

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
			updateStatusBar();
		})
	);

	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(() => {
			highlights.refreshAll();
			updateStatusBar();
		}),
		vscode.window.onDidChangeVisibleTextEditors(() => {
			highlights.refreshAll();
		}),
		vscode.commands.registerCommand('kciMirror.refresh', () => {
			provider.refresh();
			highlights.refreshAll();
		}),
		vscode.commands.registerCommand('kciMirror.addSelectionToContextWithCurrent', async () => {
			const editor = vscode.window.activeTextEditor;
			if (editor && !editor.selection.isEmpty) {
				await vscode.commands.executeCommand('kciMirror.addSelectionToContext', editor.document.uri, editor.selection);
			}
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
		}),
		vscode.commands.registerCommand(
			'kciMirror.removeFileContext',
			async (node: MirrorNode | undefined) => {
				if (!node || (node.type !== 'file' && node.type !== 'dir')) {
					return;
				}
				await state.banPartsUnderPath(node.uri);
				provider.refresh();
				highlights.refreshAll();
			}
		),
		vscode.commands.registerCommand(
			'kciMirror.addFileToContext',
			async (...args: unknown[]) => {
				let targets: vscode.Uri[] = [];

				if (args.length >= 2 && Array.isArray(args[1])) {
					targets = args[1] as vscode.Uri[];
				} else if (args.length >= 1 && args[0] instanceof vscode.Uri) {
					targets = [args[0]];
				}

				if (targets.length === 0) {
					const editor = vscode.window.activeTextEditor;
					if (editor && editor.document.uri.scheme === 'file') {
						targets.push(editor.document.uri);
					}
				}

				if (targets.length === 0) {
					return;
				}

				for (const target of targets) {
					if (target.scheme !== 'file') {
						continue;
					}
					try {
						const stat = await vscode.workspace.fs.stat(target);
						if (stat.type === vscode.FileType.File) {
							await state.addFilePart(target);
						} else if (stat.type === vscode.FileType.Directory) {
							const files = await vscode.workspace.findFiles(
								new vscode.RelativePattern(target, '**/*'),
								'**/node_modules/**'
							);
							for (const file of files) {
								try {
									const fileStat = await vscode.workspace.fs.stat(file);
									if (fileStat.type === vscode.FileType.File) {
										await state.addFilePart(file);
									}
								} catch {
								}
							}
						}
					} catch {
					}
				}
				provider.refresh();
				highlights.refreshAll();
			}
		)
	);

	void state.refreshFromDisk().then(() => {
		provider.refresh();
		highlights.refreshAll();
	});
}

// This method is called when your extension is deactivated
export function deactivate() {}
