// @ts-ignore bun:test is provided by the Bun runtime during test execution.
import { afterEach, describe, expect, mock, test } from 'bun:test';

const watcherState: {
	createListeners: Array<() => void>;
	changeListeners: Array<() => void>;
	deleteListeners: Array<() => void>;
	patterns: string[];
} = {
	createListeners: [],
	changeListeners: [],
	deleteListeners: [],
	patterns: [],
};

mock.module('vscode', () => ({
	workspace: {
		createFileSystemWatcher: mock((pattern: string) => {
			watcherState.patterns.push(pattern);
			return {
				onDidCreate: (listener: () => void) => {
					watcherState.createListeners.push(listener);
					return { dispose() {} };
				},
				onDidChange: (listener: () => void) => {
					watcherState.changeListeners.push(listener);
					return { dispose() {} };
				},
				onDidDelete: (listener: () => void) => {
					watcherState.deleteListeners.push(listener);
					return { dispose() {} };
				},
				dispose() {}
			};
		}),
	}
}));

const { ContextFileSync } = await import('./contextFileSync');

describe('ContextFileSync', () => {
	afterEach(() => {
		watcherState.createListeners = [];
		watcherState.changeListeners = [];
		watcherState.deleteListeners = [];
		watcherState.patterns = [];
	});

	test('refreshes state before notifying listeners', async () => {
		const order: string[] = [];
		const state = {
			refreshFromDisk: mock(async () => {
				order.push('refresh');
			})
		};
		const onRefresh = mock(() => {
			order.push('notify');
		});

		const sync = new ContextFileSync(state as any, onRefresh, {
			patterns: ['**/.contexty/sessions/*/tool-parts.json'],
			delayMs: 0
		});
		watcherState.changeListeners[0]?.();
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(watcherState.patterns).toEqual(['**/.contexty/sessions/*/tool-parts.json']);
		expect(state.refreshFromDisk).toHaveBeenCalledTimes(1);
		expect(onRefresh).toHaveBeenCalledTimes(1);
		expect(order).toEqual(['refresh', 'notify']);

		sync.dispose();
	});

	test('debounces repeated file events into a single refresh', async () => {
		const state = {
			refreshFromDisk: mock(async () => undefined)
		};
		const onRefresh = mock(() => undefined);

		const sync = new ContextFileSync(state as any, onRefresh, {
			patterns: ['**/.contexty/sessions/*/tool-parts.blacklist.json'],
			delayMs: 5
		});

		watcherState.changeListeners[0]?.();
		watcherState.changeListeners[0]?.();
		watcherState.changeListeners[0]?.();
		await new Promise((resolve) => setTimeout(resolve, 20));

		expect(state.refreshFromDisk).toHaveBeenCalledTimes(1);
		expect(onRefresh).toHaveBeenCalledTimes(1);

		sync.dispose();
	});
});
