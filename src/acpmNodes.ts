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

export type ACPMNode = {
	type: ACPMNodeType;
	uri: vscode.Uri;
	label: string;
	tooltip?: string;
	permissionsFile?: PermissionsFile;
	preset?: Preset;
	folderPermission?: FolderPermission;
	toolPermission?: ToolPermission;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function formatFolderPathLabel(folderPath: string): string {
	const normalized = folderPath.replace(/\\/g, '/').trim();
	if (normalized.length === 0) {
		return '/';
	}
	return normalized.endsWith('/') ? normalized : `${normalized}/`;
}

function formatPresetLabel(preset: Preset, activePreset?: string): string {
	return preset.name === activePreset ? `${preset.name} ★` : preset.name;
}

function formatFolderPermissionLabel(folderPermission: FolderPermission): string {
	return `${formatFolderPathLabel(folderPermission.path)} (${folderPermission.access})`;
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
		(value.category === 'file-read' || value.category === 'file-write' || value.category === 'shell' || value.category === 'web' || value.category === 'lsp' || value.category === 'mcp') &&
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
		if (!node.preset) {
			return [];
		}

		return [
			...node.preset.folderPermissions.map<ACPMNode>((folderPermission) => ({
				type: 'acpm-folder-perm',
				uri: node.uri,
				label: formatFolderPermissionLabel(folderPermission),
				tooltip: `${folderPermission.access} • ${folderPermission.path}`,
				description: folderPermission.access === 'denied' ? 'denied' : undefined,
				folderPermission
			})),
			...node.preset.toolPermissions.map<ACPMNode>((toolPermission) => ({
				type: 'acpm-tool-perm',
				uri: node.uri,
				label: formatToolPermissionLabel(toolPermission),
				tooltip: `${toolPermission.enabled ? 'enabled' : 'disabled'} • ${toolPermission.category}`,
				toolPermission
			}))
		];
	}

	return [];
}

export function getACPMTreeItem(node: ACPMNode): vscode.TreeItem {
	const collapsibleState =
		node.type === 'acpm-root'
			? vscode.TreeItemCollapsibleState.Expanded
			: node.type === 'acpm-preset' && node.preset
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
		if (node.folderPermission?.access === 'denied') {
			item.description = 'denied';
		}
		return item;
	}

	item.contextValue = 'contexty.acpm.tool-perm';
	item.iconPath = new vscode.ThemeIcon(node.toolPermission?.enabled ? 'check' : 'x');
	return item;
}
