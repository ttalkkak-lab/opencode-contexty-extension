// @ts-ignore bun:test is provided by the Bun runtime during test execution.
import { describe, expect, mock, test } from 'bun:test';

const workspaceState = {
	workspaceFolders: [{ uri: { fsPath: '/workspace', scheme: 'file', toString: () => 'file:///workspace' } }],
};

mock.module('vscode', () => {
	class Uri {
		constructor(public readonly fsPath: string, public readonly scheme = 'file') {}

		static file(fsPath: string) {
			return new Uri(fsPath, 'file');
		}

		static parse(value: string) {
			if (value.startsWith('file://')) {
				return new Uri(value.replace('file://', ''), 'file');
			}
			return new Uri(value, value.includes(':') ? value.split(':', 1)[0] : '');
		}

		toString() {
			return this.scheme === 'file' ? `file://${this.fsPath}` : this.fsPath;
		}
	}

	class TreeItem {
		label: string;
		collapsibleState: number;
		tooltip?: string;
		description?: string;
		iconPath?: unknown;
		contextValue?: string;
		resourceUri?: unknown;
		command?: unknown;

		constructor(label: string, collapsibleState: number) {
			this.label = label;
			this.collapsibleState = collapsibleState;
		}
	}

	class ThemeIcon {
		constructor(public readonly id: string) {}
	}

	class EventEmitter<T> {
		readonly event = (_listener: (value: T) => unknown) => ({ dispose() {} });
		fire() {}
		dispose() {}
	}

	return {
		Uri,
		TreeItem,
		ThemeIcon,
		EventEmitter,
		TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
		workspace: {
			get workspaceFolders() {
				return workspaceState.workspaceFolders;
			},
			createFileSystemWatcher: mock(() => ({
				onDidCreate: () => ({ dispose() {} }),
				onDidChange: () => ({ dispose() {} }),
				onDidDelete: () => ({ dispose() {} }),
				dispose() {},
			})),
			findFiles: mock(async () => []),
			getWorkspaceFolder: mock(() => workspaceState.workspaceFolders[0]),
		},
		window: {
			withProgress: mock(async (_options: unknown, task: (progress: unknown) => Promise<unknown>) => task({})),
		},
	};
});

const { ContextExplorerProvider } = await import('./contextExplorer');

	describe('ContextExplorerProvider compacted parts', () => {
		test('marks compacted parts in the regular file tree', async () => {
			const state = {
				getSessionId: () => 'ses_1',
				refreshFromDisk: mock(async () => undefined),
				getRootsWithParts: () => [{ uri: { fsPath: '/workspace', scheme: 'file', toString: () => 'file:///workspace' }, label: 'Workspace' }],
				getChildrenForPath: (uri: { fsPath: string }) => uri.fsPath === '/workspace' ? ({
					dirs: [],
					files: [{ uri: { fsPath: '/workspace/src', scheme: 'file', toString: () => 'file:///workspace/src' }, label: 'src' }],
				}) : ({ dirs: [], files: [] }),
				getTotalTokens: () => 0,
				getNodeTokens: () => 0,
				getPartCountForFile: () => 1,
				getPartsForFile: (uri: { fsPath: string }) => uri.fsPath === '/workspace/src' ? ([{
					id: 'part-1',
					label: 'src/app.ts • read',
					tool: 'read',
					tooltip: 'File: /workspace/src/app.ts\nTool: read',
					truncated: false,
					state: { time: {} },
				}]) : [],
				getPartIdsForFile: () => ['part-1'],
				partsByFile: new Map([
					['file:///workspace/src', [{ id: 'part-1', callID: 'call-1', state: { input: { filePath: '/workspace/src' }, time: { start: 1 } } }]],
				]),
				compactedParts: [{ id: 'part-1', callID: 'call-1', state: { time: { compacted: true } } }],
			};

		const provider = new ContextExplorerProvider(state as any, []);
		const nodes = await provider.getChildren();

		expect(nodes[0].type).toBe('file');

		const children = await provider.getChildren(nodes[0]);
		expect(children).toHaveLength(1);
		expect(children[0]).toMatchObject({
			type: 'part',
			label: 'src/app.ts • read',
			partId: 'part-1',
			compacted: true,
		});

			const item = provider.getTreeItem(children[0]);
			expect(item.description).toBe('(compressed)');
			expect(item.tooltip).toBe('File: /workspace/src/app.ts\nTool: read');
			expect(item.iconPath).toMatchObject({ id: 'circle-slash' });
			expect(provider.getTreeItem(nodes[0]).description).toContain('(1 compressed)');
		});

		test('shows compacted counts on parent directories', async () => {
			const state = {
				getSessionId: () => 'ses_1',
				refreshFromDisk: mock(async () => undefined),
				getRootsWithParts: () => [{ uri: { fsPath: '/workspace', scheme: 'file', toString: () => 'file:///workspace' }, label: 'Workspace' }],
				getChildrenForPath: (uri: { fsPath: string }) => uri.fsPath === '/workspace' ? ({
					dirs: [{ uri: { fsPath: '/workspace/src', scheme: 'file', toString: () => 'file:///workspace/src' }, label: 'src' }],
					files: [],
				}) : uri.fsPath === '/workspace/src' ? ({
					dirs: [],
					files: [{ uri: { fsPath: '/workspace/src/app.ts', scheme: 'file', toString: () => 'file:///workspace/src/app.ts' }, label: 'app.ts' }],
				}) : ({ dirs: [], files: [] }),
				getTotalTokens: () => 0,
				getNodeTokens: () => 0,
				getPartCountForFile: () => 1,
				getPartsForFile: (uri: { fsPath: string }) => uri.fsPath === '/workspace/src/app.ts' ? ([{
					id: 'part-4',
					label: 'app.ts • read',
					tooltip: 'File: /workspace/src/app.ts',
					truncated: false,
					state: { time: {} },
				}]) : [],
				getPartIdsForFile: () => ['part-4'],
				partsByFile: new Map([
					['file:///workspace/src/app.ts', [{ id: 'part-4', callID: 'call-4', state: { input: { filePath: '/workspace/src/app.ts' }, time: { start: 1 } } }]],
				]),
				compactedParts: [{ id: 'part-4', callID: 'call-4', state: { time: { compacted: true } } }],
			};

			const provider = new ContextExplorerProvider(state as any, []);
			const rootChildren = await provider.getChildren();
			const dirNode = rootChildren[0];
			const dirItem = provider.getTreeItem(dirNode);

			expect(dirNode.type).toBe('dir');
			expect(dirItem.description).toContain('(1 compressed)');
		});

	test('keeps non-compacted parts unchanged', async () => {
		const state = {
			getSessionId: () => 'ses_1',
			refreshFromDisk: mock(async () => undefined),
			getRootsWithParts: () => [{ uri: { fsPath: '/workspace', scheme: 'file', toString: () => 'file:///workspace' }, label: 'Workspace' }],
			getChildrenForPath: () => ({
				dirs: [],
				files: [{ uri: { fsPath: '/workspace/src', scheme: 'file', toString: () => 'file:///workspace/src' }, label: 'src' }],
			}),
				getTotalTokens: () => 0,
				getNodeTokens: () => 0,
				getPartCountForFile: () => 1,
				getPartsForFile: () => ([{
				id: 'part-2',
				label: 'L1: hello',
				tooltip: 'ID: part-2',
				truncated: false,
				state: { time: {} },
			}]),
			getPartIdsForFile: () => ['part-2'],
			compactedParts: [],
		};

		const provider = new ContextExplorerProvider(state as any, []);
		const nodes = await provider.getChildren();
		const parts = await provider.getChildren(nodes[0]);

		expect(parts[0]).toMatchObject({
			type: 'part',
			label: 'L1: hello',
			partId: 'part-2',
			compacted: false,
		});

		const item = provider.getTreeItem(parts[0]);
		expect(item.label).toBe('L1: hello');
		expect(item.description).toBeUndefined();
		expect(item.tooltip).toBe('ID: part-2');
		expect(item.iconPath).toMatchObject({ id: 'symbol-file' });
	});

		test('does not mark parts as compacted when call IDs do not match', async () => {
			const state = {
				getSessionId: () => 'ses_1',
				refreshFromDisk: mock(async () => undefined),
				getRootsWithParts: () => [{ uri: { fsPath: '/workspace', scheme: 'file', toString: () => 'file:///workspace' }, label: 'Workspace' }],
				getChildrenForPath: () => ({
					dirs: [],
					files: [{ uri: { fsPath: '/workspace/src', scheme: 'file', toString: () => 'file:///workspace/src' }, label: 'src' }],
				}),
				getTotalTokens: () => 0,
				getNodeTokens: () => 0,
				getPartCountForFile: () => 1,
				getPartsForFile: () => ([{
					id: 'part-3',
					label: 'L1: world',
					tooltip: 'ID: part-3',
					truncated: true,
					state: { time: { compacted: true } },
				}]),
				getPartIdsForFile: () => ['part-3'],
				partsByFile: new Map([
					['file:///workspace/src', [{ id: 'part-3', callID: 'call-3', state: { input: { filePath: '/workspace/src' }, time: { start: 1 } } }]],
				]),
				compactedParts: [{ id: 'other-part', callID: 'other-call', state: { time: { compacted: true } } }],
			};

		const provider = new ContextExplorerProvider(state as any, []);
		const nodes = await provider.getChildren();
		const parts = await provider.getChildren(nodes[0]);

		expect(parts[0]).toMatchObject({
			type: 'part',
			compacted: false,
		});
			const item = provider.getTreeItem(parts[0]);
			expect(item.description).toBeUndefined();
			expect(item.iconPath).toMatchObject({ id: 'symbol-snippet' });
			expect(provider.getTreeItem(nodes[0]).description).not.toContain('(1 compressed)');
		});
});
