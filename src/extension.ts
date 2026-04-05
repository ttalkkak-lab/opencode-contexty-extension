import * as vscode from 'vscode';

import { ContextExplorerProvider, ContextNode, ContextDragAndDropController } from './contextExplorer';
import { ContextState } from './state';
import { SelectionLensProvider } from './selectionLens';
import { ContextHighlights } from './contextHighlights';
import { AcpmDragAndDropController, AcpmExplorerProvider, clonePreset, readPermissionsFile, writePermissionsFile } from './acpmExplorer';
import type { ACPMNode, FolderAccess, PermissionsFile, Preset, ToolCategory, ToolPermission } from './acpmNodes';

const TOOL_CATEGORIES: ToolCategory[] = ['file-read', 'file-write', 'shell', 'web', 'lsp', 'mcp'];

function refreshAcpmView(provider: AcpmExplorerProvider): void {
	provider.refresh();
}

async function pickPreset(file: PermissionsFile, title: string): Promise<Preset | undefined> {
	if (file.presets.length === 0) {
		vscode.window.showInformationMessage('No ACPM presets are configured.');
		return undefined;
	}

	const items: vscode.QuickPickItem[] = file.presets.map((preset) => ({
		label: preset.name,
		description: preset.description ?? ''
	}));
	const selected = await vscode.window.showQuickPick(
		items,
		{ title, placeHolder: 'Select a preset' }
	);
	return selected ? file.presets.find((preset) => preset.name === selected.label) : undefined;
}

export function activate(context: vscode.ExtensionContext) {
	const workspaceFolders = vscode.workspace.workspaceFolders;
	const state = new ContextState(context.workspaceState, workspaceFolders);
	const provider = new ContextExplorerProvider(state, context.subscriptions);
	const acpmProvider = new AcpmExplorerProvider(context.subscriptions);
	const selectionLens = new SelectionLensProvider();
	const highlights = new ContextHighlights(state);

	const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
	statusBarItem.command = 'contexty.hscmm.addSelectionToContextWithCurrent';
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

	const treeView = vscode.window.createTreeView('contexty.hscmm.explorer', {
		treeDataProvider: provider,
		showCollapseAll: true,
		dragAndDropController: new ContextDragAndDropController(state, provider)
	});
	const acpmTreeView = vscode.window.createTreeView('contexty.acpm.explorer', {
		treeDataProvider: acpmProvider,
		showCollapseAll: true,
		dragAndDropController: new AcpmDragAndDropController(acpmProvider)
	});
	context.subscriptions.push(treeView, acpmTreeView, highlights);

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
		vscode.commands.registerCommand('contexty.hscmm.refresh', () => {
			provider.refresh();
			highlights.refreshAll();
		}),
		vscode.commands.registerCommand('contexty.acpm.refresh', () => {
			refreshAcpmView(acpmProvider);
		}),
		vscode.commands.registerCommand('contexty.acpm.createPreset', async () => {
			const name = await vscode.window.showInputBox({
				title: 'Create ACPM Preset',
				prompt: 'Enter a preset name',
				validateInput: (value) => (value.trim().length === 0 ? 'Preset name is required.' : undefined)
			});
			if (!name) {
				return;
			}

			const file = await readPermissionsFile();
			if (file.presets.some((preset) => preset.name === name.trim())) {
				vscode.window.showWarningMessage(`Preset "${name.trim()}" already exists.`);
				return;
			}

			const description = await vscode.window.showInputBox({
				title: 'Create ACPM Preset',
				prompt: 'Optional description'
			});

			file.presets.push({
				name: name.trim(),
				description: description?.trim() || undefined,
				folderPermissions: [],
				toolPermissions: [],
				defaultPolicy: 'allow-all'
			});
			await writePermissionsFile(file);
			refreshAcpmView(acpmProvider);
		}),
		vscode.commands.registerCommand('contexty.acpm.deletePreset', async (node?: ACPMNode) => {
			const file = await readPermissionsFile();
			const initialPreset = node && node.type === 'acpm-preset' ? node.preset : undefined;
			const preset = initialPreset ?? (await pickPreset(file, 'Delete ACPM Preset'));
			if (!preset) {
				return;
			}

			const decision = await vscode.window.showWarningMessage(
				`Delete preset "${preset.name}"?`,
				{ modal: true },
				'Delete'
			);
			if (decision !== 'Delete') {
				return;
			}

			file.presets = file.presets.filter((item) => item.name !== preset.name);
			if (file.activePreset === preset.name) {
				delete file.activePreset;
			}
			await writePermissionsFile(file);
			refreshAcpmView(acpmProvider);
		}),
		vscode.commands.registerCommand('contexty.acpm.switchPreset', async (node?: ACPMNode) => {
			const file = await readPermissionsFile();
			const preset = node && node.type === 'acpm-preset' ? node.preset : await pickPreset(file, 'Switch ACPM Preset');
			if (!preset) {
				return;
			}

			file.activePreset = preset.name;
			await writePermissionsFile(file);
			refreshAcpmView(acpmProvider);
			vscode.window.showInformationMessage(`Active preset set to "${preset.name}".`);
		}),
		vscode.commands.registerCommand('contexty.acpm.addFolderPermission', async (node?: ACPMNode) => {
			const file = await readPermissionsFile();
			const preset = node && node.type === 'acpm-preset' ? node.preset : await pickPreset(file, 'Add Folder Permission');
			if (!preset) {
				return;
			}

			const folderPath = await vscode.window.showInputBox({
				title: 'Add Folder Permission',
				prompt: 'Enter a folder path',
				validateInput: (value) => (value.trim().length === 0 ? 'Folder path is required.' : undefined)
			});
			if (!folderPath) {
				return;
			}

			const access = await vscode.window.showQuickPick(
				['denied', 'read-only', 'read-write'],
				{
					title: 'Add Folder Permission',
					placeHolder: 'Select access level'
				}
			);
			if (!access) {
				return;
			}

			const target = file.presets.find((item) => item.name === preset.name);
			if (!target) {
				return;
			}

			const nextPreset = clonePreset(target);
			nextPreset.folderPermissions = nextPreset.folderPermissions.filter((permission) => permission.path !== folderPath.trim());
			nextPreset.folderPermissions.push({ path: folderPath.trim(), access: access as FolderAccess });
			file.presets = file.presets.map((item) => (item.name === nextPreset.name ? nextPreset : item));
			await writePermissionsFile(file);
			refreshAcpmView(acpmProvider);
		}),
		vscode.commands.registerCommand('contexty.acpm.removeFolderPermission', async (node?: ACPMNode) => {
			if (node?.type === 'acpm-folder-perm' && node.folderPermission && node.parentPresetName) {
				const file = await readPermissionsFile();
				const target = file.presets.find((preset) => preset.name === node.parentPresetName);
				if (!target) {
					return;
				}

				const nextPreset = clonePreset(target);
				nextPreset.folderPermissions = nextPreset.folderPermissions.filter(
					(permission) => !(permission.path === node.folderPermission!.path && permission.access === node.folderPermission!.access)
				);
				file.presets = file.presets.map((item) => (item.name === nextPreset.name ? nextPreset : item));
				await writePermissionsFile(file);
				refreshAcpmView(acpmProvider);
				return;
			}

			const file = await readPermissionsFile();
			const preset = node && node.type === 'acpm-preset' ? node.preset : await pickPreset(file, 'Remove Folder Permission');
			if (!preset) {
				return;
			}

			const target = file.presets.find((item) => item.name === preset.name);
			if (!target || target.folderPermissions.length === 0) {
				vscode.window.showInformationMessage('No folder permissions to remove.');
				return;
			}

			const selected = await vscode.window.showQuickPick(
				target.folderPermissions.map((permission) => ({ label: permission.path, description: permission.access })),
				{ title: 'Remove Folder Permission', placeHolder: 'Select a folder rule' }
			);
			if (!selected) {
				return;
			}

			const nextPreset = clonePreset(target);
			nextPreset.folderPermissions = nextPreset.folderPermissions.filter((permission) => permission.path !== selected.label);
			file.presets = file.presets.map((item) => (item.name === nextPreset.name ? nextPreset : item));
			await writePermissionsFile(file);
			refreshAcpmView(acpmProvider);
		}),
		vscode.commands.registerCommand('contexty.acpm.changeFolderAccess', async (node?: ACPMNode) => {
			if (!node || node.type !== 'acpm-folder-perm' || !node.folderPermission || !node.parentPresetName) {
				return;
			}

			const currentAccess = node.folderPermission.access;
			const next = await vscode.window.showQuickPick(
				(['denied', 'read-only', 'read-write'] as const).filter((access) => access !== currentAccess),
				{ title: 'Change Access Level', placeHolder: `Current: ${currentAccess}` }
			);
			if (!next) {
				return;
			}
			const nextAccess = next as FolderAccess;

			const file = await readPermissionsFile();
			const target = file.presets.find((preset) => preset.name === node.parentPresetName);
			if (!target) {
				return;
			}

			const nextPreset = clonePreset(target);
			nextPreset.folderPermissions = nextPreset.folderPermissions.map((permission) =>
				permission.path === node.folderPermission!.path ? { ...permission, access: nextAccess } : permission
			);
			file.presets = file.presets.map((item) => (item.name === nextPreset.name ? nextPreset : item));
			await writePermissionsFile(file);
			refreshAcpmView(acpmProvider);
		}),
		vscode.commands.registerCommand('contexty.acpm.toggleTool', async (node?: ACPMNode) => {
			const file = await readPermissionsFile();
			const preset = node && node.type === 'acpm-preset' ? node.preset : await pickPreset(file, 'Toggle Tool Category');
			if (!preset) {
				return;
			}

			const category = await vscode.window.showQuickPick(
				TOOL_CATEGORIES,
				{
					title: 'Toggle Tool Category',
					placeHolder: 'Select a tool category'
				}
			);
			if (!category) {
				return;
			}

			const target = file.presets.find((item) => item.name === preset.name);
			if (!target) {
				return;
			}

			const nextPreset = clonePreset(target);
			const existing = nextPreset.toolPermissions.find((permission) => permission.category === category);
			if (existing) {
				existing.enabled = !existing.enabled;
			} else {
				nextPreset.toolPermissions.push({ category: category as ToolCategory, enabled: false } satisfies ToolPermission);
			}
			file.presets = file.presets.map((item) => (item.name === nextPreset.name ? nextPreset : item));
			await writePermissionsFile(file);
			refreshAcpmView(acpmProvider);
		}),
		vscode.commands.registerCommand('contexty.hscmm.addSelectionToContextWithCurrent', async () => {
			const editor = vscode.window.activeTextEditor;
			if (editor && !editor.selection.isEmpty) {
				await vscode.commands.executeCommand('contexty.hscmm.addSelectionToContext', editor.document.uri, editor.selection);
			}
		}),
		vscode.commands.registerCommand(
			'contexty.hscmm.addSelectionToContext',
			async (uri: vscode.Uri, selection: vscode.Selection) => {
				const doc = await vscode.workspace.openTextDocument(uri);
				await state.addSelectionPart(doc, selection);
				selectionLens.clearSelection(uri);
				provider.refresh();
				highlights.refreshAll();
			}
		),
		vscode.commands.registerCommand('contexty.hscmm.removePart', async (node: ContextNode | undefined) => {
			if (!node || node.type !== 'part' || !node.partId) {
				return;
			}
			await state.banPart(node.partId);
			provider.refresh();
			highlights.refreshAll();
		}),
		vscode.commands.registerCommand(
			'contexty.hscmm.removeFileContext',
			async (node: ContextNode | undefined) => {
				if (!node || (node.type !== 'file' && node.type !== 'dir')) {
					return;
				}
				await state.banPartsUnderPath(node.uri);
				provider.refresh();
				highlights.refreshAll();
			}
		),
		vscode.commands.registerCommand('contexty.hscmm.resetContext', async () => {
			const confirmLabel = 'Reset';
			const decision = await vscode.window.showWarningMessage(
				'Reset all context parts?',
				{
					modal: true,
					detail: 'All accumulated context parts will be added to blacklist.'
				},
				confirmLabel
			);
			if (decision !== confirmLabel) {
				return;
			}

			const added = await state.banAllParts();
			provider.refresh();
			highlights.refreshAll();
			vscode.window.showInformationMessage(
				added > 0
					? `Context reset complete: ${added} part(s) added to blacklist.`
					: 'Context reset complete: no active parts to blacklist.'
			);
		}),
		vscode.commands.registerCommand(
			'contexty.hscmm.addFileToContext',
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
		refreshAcpmView(acpmProvider);
	});
}

export function deactivate() {}
