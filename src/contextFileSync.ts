import * as vscode from 'vscode';

import { ContextState } from './state';

export const DEFAULT_CONTEXT_SYNC_PATTERNS = [
	'**/.contexty/sessions/*/tool-parts.json',
	'**/.contexty/sessions/*/tool-parts.blacklist.json',
	'**/.contexty/sessions/*/pruning-state.json',
	'**/.contexty/tool-parts.json',
	'**/.contexty/tool-parts.blacklist.json',
];

type ContextFileSyncOptions = {
	patterns?: string[];
	delayMs?: number;
};

export class ContextFileSync implements vscode.Disposable {
	private readonly watchers: vscode.Disposable[] = [];
	private refreshTimer: ReturnType<typeof setTimeout> | undefined;
	private refreshNonce = 0;
	private readonly delayMs: number;

	constructor(
		private readonly state: Pick<ContextState, 'refreshFromDisk'>,
		private readonly onRefresh: () => void,
		options: ContextFileSyncOptions = {}
	) {
		const patterns = options.patterns ?? DEFAULT_CONTEXT_SYNC_PATTERNS;
		this.delayMs = options.delayMs ?? 150;

		for (const pattern of patterns) {
			const watcher = vscode.workspace.createFileSystemWatcher(pattern);
			this.watchers.push(
				watcher,
				watcher.onDidCreate(() => this.queueRefresh()),
				watcher.onDidChange(() => this.queueRefresh()),
				watcher.onDidDelete(() => this.queueRefresh())
			);
		}
	}

	private queueRefresh(): void {
		if (this.refreshTimer) {
			clearTimeout(this.refreshTimer);
		}

		const nonce = ++this.refreshNonce;
		this.refreshTimer = setTimeout(() => {
			this.refreshTimer = undefined;
			void this.refresh(nonce);
		}, this.delayMs);
	}

	private async refresh(nonce: number): Promise<void> {
		await this.state.refreshFromDisk();
		if (nonce !== this.refreshNonce) {
			return;
		}
		this.onRefresh();
	}

	dispose(): void {
		if (this.refreshTimer) {
			clearTimeout(this.refreshTimer);
			this.refreshTimer = undefined;
		}
		for (const watcher of this.watchers) {
			watcher.dispose();
		}
	}
}
