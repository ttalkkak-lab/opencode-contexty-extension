// @ts-ignore bun:test is provided by the Bun runtime during test execution.
import { beforeEach, describe, expect, mock, test } from 'bun:test';

const listeners = {
	create: [] as Array<() => void>,
	change: [] as Array<() => void>,
	delete: [] as Array<() => void>,
};

mock.module('vscode', () => {
	class EventEmitter<T> {
		private listeners = new Set<(value: T) => unknown>();

		readonly event = (listener: (value: T) => unknown) => {
			this.listeners.add(listener);
			return { dispose: () => this.listeners.delete(listener) };
		};

		fire(value: T) {
			for (const listener of this.listeners) {
				listener(value);
			}
		}

		dispose() {
			this.listeners.clear();
		}
	}

	return {
		EventEmitter,
		workspace: {
			createFileSystemWatcher: mock(() => ({
				onDidCreate: (listener: () => void) => {
					listeners.create.push(listener);
					return { dispose() {} };
				},
				onDidChange: (listener: () => void) => {
					listeners.change.push(listener);
					return { dispose() {} };
				},
				onDidDelete: (listener: () => void) => {
					listeners.delete.push(listener);
					return { dispose() {} };
				},
				dispose() {}
			}))
		}
	};
});

const { SessionDiscovery } = await import('./sessionDiscovery');

describe('SessionDiscovery', () => {
	beforeEach(() => {
		listeners.create = [];
		listeners.change = [];
		listeners.delete = [];
	});

	test('does not emit active-session changes when the newest session stays the same', async () => {
		const discovery = new SessionDiscovery([]);
		const activeEvents: string[] = [];
		discovery.onDidChangeActiveSession((session) => {
			activeEvents.push(session.sessionId);
		});

		const discoverSessions = mock(async () => [
			{ sessionId: 'ses_1', lastModified: new Date(1), path: { path: '/workspace/.contexty/sessions/ses_1' } },
		]);
		discovery.discoverSessions = discoverSessions as typeof discovery.discoverSessions;

		await discovery.refresh();
		await discovery.refresh();

		expect(activeEvents).toEqual(['ses_1']);
		expect(discoverSessions).toHaveBeenCalledTimes(2);
	});

	test('emits active-session changes when the newest session changes', async () => {
		const discovery = new SessionDiscovery([]);
		const activeEvents: string[] = [];
		discovery.onDidChangeActiveSession((session) => {
			activeEvents.push(session.sessionId);
		});

		let sessions = [
			{ sessionId: 'ses_1', lastModified: new Date(1), path: { path: '/workspace/.contexty/sessions/ses_1' } },
		];
		discovery.discoverSessions = mock(async () => sessions) as typeof discovery.discoverSessions;

		await discovery.refresh();
		sessions = [
			{ sessionId: 'ses_2', lastModified: new Date(2), path: { path: '/workspace/.contexty/sessions/ses_2' } },
			{ sessionId: 'ses_1', lastModified: new Date(1), path: { path: '/workspace/.contexty/sessions/ses_1' } },
		];
		await discovery.refresh();

		expect(activeEvents).toEqual(['ses_1', 'ses_2']);
	});
});
