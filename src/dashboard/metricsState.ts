import * as vscode from 'vscode';

export interface MetricsSnapshot {
	version: number;
	sessionID: string;
	timestamp: string;
	tokens: { input: number; output: number; reasoning: number; cacheRead: number; cacheWrite: number };
	files: { path: string; tokenEstimate: number; role: string }[];
	tools: { name: string; count: number; successCount: number; failCount: number }[];
	acpm: {
		activePreset: string | null;
		allowCount: number;
		denyCount: number;
		sanitizeCount: number;
		deniedByCategory: Record<string, number>;
		folderAccessDistribution: Record<string, number>;
		toolCategoryStatus: { category: string; enabled: boolean }[];
	};
}

export class MetricsState {
	currentSessionId: string | undefined;
	onMetricsUpdate: ((snapshot: MetricsSnapshot | null) => void) | null = null;

	private watcher: vscode.FileSystemWatcher | undefined;
	private debounceTimer: ReturnType<typeof setTimeout> | undefined;
	private readonly decoder = new TextDecoder();

	constructor(private readonly subscriptions: vscode.Disposable[]) {}

	setSessionId(sessionId: string | undefined): void {
		this.disposeWatcher();
		this.currentSessionId = sessionId;

		if (sessionId) {
			const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
			if (workspaceRoot) {
				const pattern = new vscode.RelativePattern(workspaceRoot, `.contexty/sessions/${sessionId}/metrics.json`);
				this.watcher = vscode.workspace.createFileSystemWatcher(pattern);
				this.subscriptions.push(
					this.watcher,
					this.watcher.onDidCreate(() => this.refreshSoon()),
					this.watcher.onDidChange(() => this.refreshSoon()),
					this.watcher.onDidDelete(() => this.onMetricsUpdate?.(null))
				);
			}
		}

		void this.loadAndNotify();
	}

	dispose(): void {
		this.disposeWatcher();
	}

	private refreshSoon(): void {
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
		}
		this.debounceTimer = setTimeout(() => void this.loadAndNotify(), 150);
	}

	private async loadAndNotify(): Promise<void> {
		const snapshot = await this.loadSnapshot();
		this.onMetricsUpdate?.(snapshot);
	}

	private async loadSnapshot(): Promise<MetricsSnapshot | null> {
		const sessionId = this.currentSessionId;
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
		if (!sessionId || !workspaceRoot) {
			return null;
		}

		const fileUri = vscode.Uri.joinPath(workspaceRoot, '.contexty', 'sessions', sessionId, 'metrics.json');
		try {
			const raw = await vscode.workspace.fs.readFile(fileUri);
			return JSON.parse(this.decoder.decode(raw)) as MetricsSnapshot;
		} catch {
			return null;
		}
	}

	private disposeWatcher(): void {
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
			this.debounceTimer = undefined;
		}

		if (this.watcher) {
			this.watcher.dispose();
			this.watcher = undefined;
		}
	}
}
