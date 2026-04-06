import * as vscode from 'vscode';

export interface SessionInfo {
	sessionId: string;
	title?: string;
	lastModified: Date;
	path: vscode.Uri;
}

export class SessionDiscovery {
	private sessions: SessionInfo[] = [];
	private autoMode = true;
	private readonly _onDidChangeSessions = new vscode.EventEmitter<void>();
	readonly onDidChangeSessions = this._onDidChangeSessions.event;
	private readonly _onDidChangeActiveSession = new vscode.EventEmitter<SessionInfo>();
	readonly onDidChangeActiveSession = this._onDidChangeActiveSession.event;
	private watcher: vscode.FileSystemWatcher | null = null;

	constructor(private readonly subscriptions: vscode.Disposable[], autoMode = true) {
		this.autoMode = autoMode;
		this.startWatching();
	}

	isAutoMode(): boolean {
		return this.autoMode;
	}

	setAutoMode(enabled: boolean): void {
		this.autoMode = enabled;
	}

	toggleAutoMode(): void {
		this.autoMode = !this.autoMode;
	}

	private startWatching(): void {
		this.watcher = vscode.workspace.createFileSystemWatcher('**/.contexty/sessions/*/tool-parts.json');
		this.subscriptions.push(
			this.watcher,
			this.watcher.onDidCreate(() => this.refresh()),
			this.watcher.onDidChange(() => this.refresh()),
			this.watcher.onDidDelete(() => this.refresh())
		);
	}

	async refresh(): Promise<void> {
		this.sessions = await this.discoverSessions();
		if (this.autoMode && this.sessions.length > 0) {
			this._onDidChangeActiveSession.fire(this.sessions[0]);
		}
		this._onDidChangeSessions.fire();
	}

	async discoverSessions(): Promise<SessionInfo[]> {
		const sessionUris = await vscode.workspace.findFiles('**/.contexty/sessions/*/tool-parts.json', '**/node_modules/**');

		const sessions: SessionInfo[] = [];
		for (const uri of sessionUris) {
			try {
				const stat = await vscode.workspace.fs.stat(uri);
				const dirName = vscode.Uri.joinPath(uri, '..').path.split('/').pop() || '';
				if (dirName) {
					sessions.push({
						sessionId: dirName,
						lastModified: new Date(stat.mtime),
						path: vscode.Uri.joinPath(uri, '..')
					});
					const metaUri = vscode.Uri.joinPath(uri, '..', 'meta.json');
					try {
						const metaRaw = await vscode.workspace.fs.readFile(metaUri);
						const meta = JSON.parse(Buffer.from(metaRaw).toString('utf8'));
						if (typeof meta?.title === 'string' && meta.title.trim()) {
							sessions[sessions.length - 1].title = meta.title.trim();
						}
					} catch {
					}
				}
			} catch {
				continue;
			}
		}

		sessions.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
		return sessions;
	}

	async getActiveSession(): Promise<SessionInfo | undefined> {
		if (this.sessions.length === 0) {
			await this.refresh();
		}
		return this.sessions[0];
	}

	getAllSessions(): SessionInfo[] {
		return [...this.sessions];
	}

	dispose(): void {
		this._onDidChangeActiveSession.dispose();
		this._onDidChangeSessions.dispose();
	}
}
