import * as vscode from 'vscode';

export type FolderAccess = 'denied' | 'read-only' | 'read-write';
export type ToolCategory = 'file-read' | 'file-write' | 'shell' | 'web' | 'lsp' | 'mcp';

export interface FolderPermission {
	path: string;
	access: FolderAccess;
}

export interface ToolPermission {
	category: ToolCategory;
	enabled: boolean;
}

export interface Preset {
	name: string;
	description?: string;
	folderPermissions: FolderPermission[];
	toolPermissions: ToolPermission[];
	defaultPolicy: 'allow-all';
}

export interface PermissionsFile {
	version: number;
	presets: Preset[];
	activePreset?: string;
}

export type ACPMNodeType = 'acpm-root' | 'acpm-preset' | 'acpm-folder-perm' | 'acpm-tool-perm';

export const ALL_TOOL_CATEGORIES: ToolCategory[] = ['file-read', 'file-write', 'shell', 'web', 'lsp', 'mcp'];

export type ACPMNode = {
	type: ACPMNodeType;
	uri: vscode.Uri;
	label: string;
	tooltip?: string;
	permissionsFile?: PermissionsFile;
	preset?: Preset;
	folderPermission?: FolderPermission;
	toolPermission?: ToolPermission;
	parentPresetName?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function formatFolderPathLabel(folderPath: string): string {
	const normalized = folderPath.replace(/\\/g, '/').trim();
	return normalized.length === 0 ? '.' : normalized;
}

function formatPresetLabel(preset: Preset, activePreset?: string): string {
	return preset.name === activePreset ? `${preset.name} ★` : preset.name;
}

function formatFolderPermissionLabel(folderPermission: FolderPermission): string {
	return formatFolderPathLabel(folderPermission.path);
}

function formatToolPermissionLabel(toolPermission: ToolPermission): string {
	return `${toolPermission.category} (${toolPermission.enabled ? 'enabled' : 'disabled'})`;
}

function isFolderPermission(value: unknown): value is FolderPermission {
	return (
		isRecord(value) &&
		typeof value.path === 'string' &&
		(value.access === 'denied' || value.access === 'read-only' || value.access === 'read-write')
	);
}

function isToolPermission(value: unknown): value is ToolPermission {
	return (
		isRecord(value) &&
		ALL_TOOL_CATEGORIES.includes(value.category as ToolCategory) &&
		typeof value.enabled === 'boolean'
	);
}

function isPreset(value: unknown): value is Preset {
	return (
		isRecord(value) &&
		typeof value.name === 'string' &&
		(value.description === undefined || typeof value.description === 'string') &&
		Array.isArray(value.folderPermissions) &&
		value.folderPermissions.every(isFolderPermission) &&
		Array.isArray(value.toolPermissions) &&
		value.toolPermissions.every(isToolPermission) &&
		value.defaultPolicy === 'allow-all'
	);
}

export function parsePermissionsFile(value: unknown): PermissionsFile {
	if (
		isRecord(value) &&
		typeof value.version === 'number' &&
		Array.isArray(value.presets) &&
		value.presets.every(isPreset) &&
		(value.activePreset === undefined || typeof value.activePreset === 'string')
	) {
		return { version: value.version, presets: value.presets, activePreset: value.activePreset };
	}

	return { version: 1, presets: [] };
}

export function isACPMNodeType(value: string): value is ACPMNodeType {
	return value === 'acpm-root' || value === 'acpm-preset' || value === 'acpm-folder-perm' || value === 'acpm-tool-perm';
}

function normalizeFolderPath(value: string): string {
	return value.replace(/\\/g, '/').trim().replace(/\/+$/u, '');
}

function isParentPath(parent: string, child: string): boolean {
	const normalizedParent = normalizeFolderPath(parent);
	const normalizedChild = normalizeFolderPath(child);
	return normalizedChild !== normalizedParent && normalizedChild.startsWith(`${normalizedParent}/`);
}

function hasChildFolderPermission(folderPermission: FolderPermission, folderPermissions: FolderPermission[]): boolean {
	return folderPermissions.some((candidate) => isParentPath(folderPermission.path, candidate.path));
}

function getChildFolderPermissions(folderPermission: FolderPermission, folderPermissions: FolderPermission[]): FolderPermission[] {
	const parentPath = normalizeFolderPath(folderPermission.path);
	return folderPermissions.filter((candidate) => {
		if (!isParentPath(folderPermission.path, candidate.path)) {
			return false;
		}
		return !folderPermissions.some((other) => {
			if (other.path === candidate.path) {
				return false;
			}
			return isParentPath(parentPath, other.path) && isParentPath(other.path, candidate.path);
		});
	});
}

export function isACPMNode(node: { type: string }): node is ACPMNode {
	return isACPMNodeType(node.type);
}

export function getACPMChildren(node: ACPMNode): ACPMNode[] {
	if (node.type === 'acpm-root') {
		const presets = node.permissionsFile?.presets ?? [];
		const activePreset = node.permissionsFile?.activePreset;
		if (presets.length === 0) {
			return [{
				type: 'acpm-preset',
				uri: node.uri,
				label: 'No presets configured'
			}];
		}

		return presets.map<ACPMNode>((preset) => ({
			type: 'acpm-preset',
			uri: node.uri,
			label: formatPresetLabel(preset, activePreset),
			tooltip: preset.description,
			preset
		}));
	}

	if (node.type === 'acpm-preset') {
		const preset = node.preset;
		if (!preset) {
			return [];
		}

		const folderPermissions = preset.folderPermissions.filter((folderPermission) =>
			!preset.folderPermissions.some((candidate) => candidate !== folderPermission && isParentPath(candidate.path, folderPermission.path))
		);

		return [
			...folderPermissions.map<ACPMNode>((folderPermission) => ({
				type: 'acpm-folder-perm',
				uri: node.uri,
				label: formatFolderPermissionLabel(folderPermission),
				tooltip: `${folderPermission.access} • ${folderPermission.path}`,
				folderPermission,
				preset,
				parentPresetName: preset.name
			})),
			...preset.toolPermissions.map<ACPMNode>((toolPermission) => ({
				type: 'acpm-tool-perm',
				uri: node.uri,
				label: formatToolPermissionLabel(toolPermission),
				tooltip: `${toolPermission.enabled ? 'enabled' : 'disabled'} • ${toolPermission.category}`,
				toolPermission,
				parentPresetName: preset.name
			}))
		];
	}

	if (node.type === 'acpm-folder-perm') {
		const preset = node.preset;
		const folderPermission = node.folderPermission;
		if (!preset || !folderPermission) {
			return [];
		}

		return getChildFolderPermissions(folderPermission, preset.folderPermissions).map<ACPMNode>((childFolderPermission) => ({
			type: 'acpm-folder-perm',
			uri: node.uri,
			label: formatFolderPermissionLabel(childFolderPermission),
			tooltip: `${childFolderPermission.access} • ${childFolderPermission.path}`,
			folderPermission: childFolderPermission,
			preset,
			parentPresetName: preset.name
		}));
	}

	return [];
}

export function getACPMTreeItem(node: ACPMNode): vscode.TreeItem {
	const folderHasChildren = node.type === 'acpm-folder-perm' && !!node.preset && !!node.folderPermission && hasChildFolderPermission(node.folderPermission, node.preset.folderPermissions);
	const collapsibleState =
		node.type === 'acpm-root'
			? vscode.TreeItemCollapsibleState.Expanded
			: node.type === 'acpm-preset' && node.preset
				? vscode.TreeItemCollapsibleState.Collapsed
				: folderHasChildren
					? vscode.TreeItemCollapsibleState.Collapsed
				: vscode.TreeItemCollapsibleState.None;

	const item = new vscode.TreeItem(node.label, collapsibleState);
	item.resourceUri = node.uri;
	item.tooltip = node.tooltip ?? node.label;

	if (node.type === 'acpm-root') {
		item.contextValue = 'contexty.acpm.root';
		item.iconPath = new vscode.ThemeIcon('shield');
		return item;
	}

	if (node.type === 'acpm-preset') {
		item.contextValue = 'contexty.acpm.preset';
		item.iconPath = new vscode.ThemeIcon('settings-gear');
		return item;
	}

	if (node.type === 'acpm-folder-perm') {
		item.contextValue = 'contexty.acpm.folder-perm';
		item.iconPath = new vscode.ThemeIcon(node.folderPermission?.access === 'read-write' ? 'folder-opened' : 'folder');
		item.description = node.folderPermission?.access;
		item.command = {
			command: 'contexty.acpm.changeFolderAccess',
			title: 'Change Access',
			arguments: [node]
		};
		return item;
	}

	item.contextValue = 'contexty.acpm.tool-perm';
	item.iconPath = new vscode.ThemeIcon(node.toolPermission?.enabled ? 'check' : 'x');
	item.command = {
		command: 'contexty.acpm.toggleTool',
		title: 'Toggle Tool',
		arguments: [node]
	};
	return item;
}
