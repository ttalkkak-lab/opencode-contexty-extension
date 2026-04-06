import * as path from 'path';
import { mkdir, readFile, writeFile } from 'fs/promises';
import * as vscode from 'vscode';

import {
	ALL_TOOL_CATEGORIES,
	getACPMChildren,
	getACPMTreeItem,
	parsePermissionsFile,
	type ACPMNode,
	type FolderAccess,
	type PermissionsFile,
	type Preset
} from './acpmNodes';
import { ContextState } from './state';

function getWorkspaceRootUri(): vscode.Uri | undefined {
	return vscode.workspace.workspaceFolders?.find((folder) => folder.uri.scheme === 'file')?.uri;
}

export function getPermissionsFileUri(): vscode.Uri | undefined {
	const workspaceRoot = getWorkspaceRootUri();
	return workspaceRoot ? vscode.Uri.joinPath(workspaceRoot, '.contexty', 'permissions.json') : undefined;
}

const DEFAULT_PRESET_NAME = 'Default';

function createDefaultPreset(_workspaceRoot: vscode.Uri): Preset {
	return {
		name: DEFAULT_PRESET_NAME,
		description: 'Default preset — all tools allowed, project root read-write',
		folderPermissions: [{ path: '.', access: 'read-write' }],
		toolPermissions: ALL_TOOL_CATEGORIES.map((category) => ({ category, enabled: true })),
		defaultPolicy: 'allow-all'
	};
}

function createDefaultPermissionsFile(workspaceRoot: vscode.Uri): PermissionsFile {
	return {
		version: 1,
		presets: [createDefaultPreset(workspaceRoot)],
		activePreset: DEFAULT_PRESET_NAME
	};
}

export async function readPermissionsFile(): Promise<PermissionsFile> {
	const fileUri = getPermissionsFileUri();
	if (!fileUri) {
		return { version: 1, presets: [] };
	}

	try {
		const raw = await readFile(fileUri.fsPath, 'utf8');
		const parsed = parsePermissionsFile(JSON.parse(raw));
		if (parsed.presets.length === 0) {
			const workspaceRoot = getWorkspaceRootUri();
			const defaults = workspaceRoot ? createDefaultPermissionsFile(workspaceRoot) : { version: 1, presets: [] };
			await writePermissionsFile(defaults);
			return defaults;
		}
		return parsed;
	} catch {
		const workspaceRoot = getWorkspaceRootUri();
		if (!workspaceRoot) {
			return { version: 1, presets: [] };
		}
		const defaults = createDefaultPermissionsFile(workspaceRoot);
		await writePermissionsFile(defaults);
		return defaults;
	}
}

async function readSessionActivePreset(sessionId: string): Promise<string | undefined> {
	const fileUri = getWorkspaceRootUri()
		? vscode.Uri.joinPath(getWorkspaceRootUri()!, '.contexty', 'sessions', sessionId, 'active-preset.json')
		: undefined;
	if (!fileUri) {
		return undefined;
	}

	try {
		const raw = await readFile(fileUri.fsPath, 'utf8');
		const parsed = JSON.parse(raw) as { presetName?: unknown };
		return typeof parsed.presetName === 'string' ? parsed.presetName : undefined;
	} catch {
		return undefined;
	}
}

export async function writePermissionsFile(data: PermissionsFile): Promise<void> {
	const fileUri = getPermissionsFileUri();
	if (!fileUri) {
		return;
	}

	await mkdir(path.dirname(fileUri.fsPath), { recursive: true });
	await writeFile(fileUri.fsPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function normalizeFolderPath(value: string): string {
	return value.replace(/\\/g, '/').trim().replace(/\/+$/u, '');
}

function toStoredFolderPath(uri: vscode.Uri): string {
	const workspaceRoot = getWorkspaceRootUri();
	if (workspaceRoot && uri.fsPath.toLowerCase().startsWith(`${workspaceRoot.fsPath.toLowerCase()}${path.sep}`)) {
		const relative = path.relative(workspaceRoot.fsPath, uri.fsPath);
		return relative.length > 0 ? relative : '.';
	}
	return uri.fsPath;
}

export function clonePreset(preset: Preset): Preset {
	return {
		name: preset.name,
		description: preset.description,
		folderPermissions: [...preset.folderPermissions],
		toolPermissions: [...preset.toolPermissions],
		defaultPolicy: preset.defaultPolicy
	};
}

export function upsertFolderPermission(file: PermissionsFile, presetName: string, folderPath: string, access: FolderAccess): boolean {
	const target = file.presets.find((preset) => preset.name === presetName);
	if (!target) {
		return false;
	}

	const normalizedPath = normalizeFolderPath(folderPath);
	if (normalizedPath.length === 0) {
		return false;
	}

	target.folderPermissions = target.folderPermissions.filter(
		(permission) => normalizeFolderPath(permission.path) !== normalizedPath
	);
	target.folderPermissions.push({ path: folderPath.trim(), access });
	return true;
}

export class AcpmExplorerProvider implements vscode.TreeDataProvider<ACPMNode> {
	private readonly treeChangeEmitter = new vscode.EventEmitter<ACPMNode | undefined | null | void>();
	readonly onDidChangeTreeData = this.treeChangeEmitter.event;

	private refreshTimer: NodeJS.Timeout | undefined;

	constructor(
		private readonly disposables: vscode.Disposable[],
		private readonly state?: ContextState
	) {
		const watcher = vscode.workspace.createFileSystemWatcher('**/.contexty/permissions.json');
		const sessionWatcher = vscode.workspace.createFileSystemWatcher('**/.contexty/sessions/*/active-preset.json');
		this.disposables.push(
			watcher,
			watcher.onDidCreate(() => this.refreshSoon()),
			watcher.onDidChange(() => this.refreshSoon()),
			watcher.onDidDelete(() => this.refreshSoon()),
			sessionWatcher,
			sessionWatcher.onDidCreate(() => this.refreshSoon()),
			sessionWatcher.onDidChange(() => this.refreshSoon()),
			sessionWatcher.onDidDelete(() => this.refreshSoon())
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

	getTreeItem(node: ACPMNode): vscode.TreeItem {
		return getACPMTreeItem(node);
	}

	async getChildren(node?: ACPMNode): Promise<ACPMNode[]> {
		const workspaceRoot = getWorkspaceRootUri();
		if (!workspaceRoot) {
			return [];
		}

		if (!node) {
			const permissionsFile = await readPermissionsFile();
			const sessionId = this.state?.getSessionId();
			if (sessionId) {
				const sessionActivePreset = await readSessionActivePreset(sessionId);
				if (sessionActivePreset) {
					permissionsFile.activePreset = sessionActivePreset;
				}
			}
			return [{ type: 'acpm-root', uri: workspaceRoot, label: 'ACPM', permissionsFile }];
		}

		if (node.type === 'acpm-root' || node.type === 'acpm-preset' || node.type === 'acpm-folder-perm') {
			return getACPMChildren(node);
		}

		return [];
	}
}

export class AcpmDragAndDropController implements vscode.TreeDragAndDropController<ACPMNode> {
	dropMimeTypes = ['text/uri-list'];
	dragMimeTypes: string[] = [];

	constructor(private readonly provider: AcpmExplorerProvider) { }

	async handleDrop(target: ACPMNode | undefined, dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): Promise<void> {
		if (!target || target.type !== 'acpm-preset' || !target.preset) {
			return;
		}

		const uriList = dataTransfer.get('text/uri-list');
		if (!uriList) {
			return;
		}

		const rawValue = await uriList.value;
		if (typeof rawValue !== 'string') {
			return;
		}

		const droppedUris: vscode.Uri[] = [];
		for (const line of rawValue.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
			try {
				droppedUris.push(vscode.Uri.parse(line));
			} catch {
			}
		}

		const folders: vscode.Uri[] = [];
		for (const uri of droppedUris) {
			if (token.isCancellationRequested) {
				return;
			}
			if (uri.scheme !== 'file') {
				continue;
			}
			try {
				const stat = await vscode.workspace.fs.stat(uri);
				if (stat.type === vscode.FileType.Directory) {
					folders.push(uri);
				}
			} catch {
			}
		}

		if (folders.length === 0) {
			return;
		}

		const access = await vscode.window.showQuickPick(['denied', 'read-only', 'read-write'], {
			title: 'Add Folder Permission',
			placeHolder: 'Select access level'
		});
		if (!access) {
			return;
		}

		const file = await readPermissionsFile();
		let changed = false;
		for (const folder of folders) {
			if (token.isCancellationRequested) {
				break;
			}
			const storedPath = toStoredFolderPath(folder);
			changed = upsertFolderPermission(file, target.preset.name, storedPath, access as FolderAccess) || changed;
		}

		if (!changed) {
			return;
		}

		await writePermissionsFile(file);
		this.provider.refresh();
	}

	handleDrag(_source: ACPMNode[], _dataTransfer: vscode.DataTransfer, _token: vscode.CancellationToken): void {
	}
}
