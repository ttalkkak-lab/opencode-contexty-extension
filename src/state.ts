import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as path from 'path';

type StoredStateV2 = {
	version: 2;
	checked: string[];
};

type StoredStateV3 = {
	version: 3;
	checked: Array<{ uri: string; id: string }>;
};

type StoredStateV4 = {
	version: 4;
	checked: Array<{ uri: string; id: string }>;
	banned: string[];
};

const STATE_KEY = 'kciMirror.state';

function asKey(uri: vscode.Uri): string {
	// Use full URI string so multi-root workspaces stay unique.
	return uri.toString();
}

function generateCustomId(prefix: string): string {
	// Keep lexicographic ordering roughly aligned with creation time.
	const timestampHex = Date.now().toString(16).padStart(12, '0');
	const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
	let randomPart = '';
	for (let i = 0; i < 14; i++) {
		randomPart += alphabet[crypto.randomInt(0, alphabet.length)];
	}
	return `${prefix}_${timestampHex}${randomPart}`;
}

export class MirrorState {
	// Key: full URI string (uri.toString()), Value: stable generated id.
	private checked = new Map<string, string>();
	private banned = new Set<string>();
	private readonly roots: Array<{
		rootFsPathLower: string;
		partsUri: vscode.Uri;
		banUri: vscode.Uri;
	}>;

	constructor(
		private readonly memento: vscode.Memento,
		workspaceFolders?: readonly vscode.WorkspaceFolder[]
	) {
		// Persist checked files at each workspace root.
		this.roots = (workspaceFolders ?? [])
			.filter((wf) => wf.uri.scheme === 'file')
			.map((wf) => {
				const rootFsPathLower = wf.uri.fsPath.toLowerCase();
				return {
					rootFsPathLower,
					partsUri: vscode.Uri.joinPath(wf.uri, 'parts.json'),
					banUri: vscode.Uri.joinPath(wf.uri, 'ban.json')
				};
			});
		this.load();
		// Best-effort: keep the JSON file in sync on startup.
		void this.writeCheckedFile();
	}

	isChecked(uri: vscode.Uri): boolean {
		return this.checked.has(asKey(uri));
	}

	async toggleChecked(uri: vscode.Uri): Promise<void> {
		await this.setChecked(uri, !this.isChecked(uri));
	}

	async setChecked(uri: vscode.Uri, checked: boolean): Promise<void> {
		await this.setCheckedMany([{ uri, checked }]);
	}

	async setCheckedMany(updates: Array<{ uri: vscode.Uri; checked: boolean }>): Promise<void> {
		let changed = false;
		for (const { uri, checked } of updates) {
			const key = asKey(uri);
			if (checked) {
				if (!this.checked.has(key)) {
					this.checked.set(key, generateCustomId('prt'));
					changed = true;
				}
			} else {
				const existingId = this.checked.get(key);
				if (existingId) {
					this.checked.delete(key);
					if (!this.banned.has(existingId)) {
						this.banned.add(existingId);
					}
					changed = true;
				}
			}
		}

		if (!changed) {
			return;
		}

		await this.save();
		await this.writeCheckedFile();
	}

	private async writeCheckedFile(): Promise<void> {
		if (this.roots.length === 0) {
			return;
		}

		// Pre-parse checked URIs once.
		const checkedEntries: Array<{ uri: vscode.Uri; id: string }> = [];
		for (const [key, id] of this.checked.entries()) {
			try {
				checkedEntries.push({ uri: vscode.Uri.parse(key), id });
			} catch {
				// Ignore invalid entries.
			}
		}

		const banned = [...this.banned];
		banned.sort((a, b) => a.localeCompare(b));

		for (const { rootFsPathLower, partsUri, banUri } of this.roots) {
			const checked: Array<{ id: string; path: string }> = [];
			for (const { uri, id } of checkedEntries) {
				if (uri.scheme !== 'file') {
					continue;
				}
				const fsPathLower = uri.fsPath.toLowerCase();
				if (fsPathLower === rootFsPathLower || !fsPathLower.startsWith(rootFsPathLower + path.sep)) {
					continue;
				}

				try {
					const stat = await vscode.workspace.fs.stat(uri);
					if ((stat.type & vscode.FileType.File) !== vscode.FileType.File) {
						continue;
					}
				} catch {
					continue;
				}

				checked.push({ id, path: uri.fsPath });
			}
			checked.sort((a, b) => a.path.localeCompare(b.path));

			const partsContents = Buffer.from(JSON.stringify({ checked }, null, 2), 'utf8');
			try {
				await vscode.workspace.fs.writeFile(partsUri, partsContents);
			} catch {
				// Ignore file sync errors; workspaceState is still the source of truth.
			}

			const banContents = Buffer.from(JSON.stringify({ banned }, null, 2), 'utf8');
			try {
				await vscode.workspace.fs.writeFile(banUri, banContents);
			} catch {
				// Ignore file sync errors; workspaceState is still the source of truth.
			}
		}
	}

	private load(): void {
		const storedAny = this.memento.get<unknown>(STATE_KEY);
		if (!storedAny || typeof storedAny !== 'object') {
			return;
		}

		// Migration: version 1 stored `pinned` and `ignored`. We convert both into a single
		// `checked` set (union) so users don't lose their previous marks.
		const storedV1 = storedAny as { version?: unknown; pinned?: unknown; ignored?: unknown };
		if (storedV1.version === 1) {
			const pinned = Array.isArray(storedV1.pinned) ? storedV1.pinned : [];
			const ignored = Array.isArray(storedV1.ignored) ? storedV1.ignored : [];
			this.checked = new Map(
				[...(pinned as string[]), ...(ignored as string[])].map((uriStr) => [uriStr, generateCustomId('prt')])
			);
			return;
		}

		const storedV4 = storedAny as StoredStateV4;
		if (storedV4.version === 4) {
			this.checked = new Map(
				(storedV4.checked ?? [])
					.filter((x) => x && typeof x.uri === 'string' && typeof x.id === 'string')
					.map((x) => [x.uri, x.id])
			);
			this.banned = new Set((storedV4.banned ?? []).filter((x) => typeof x === 'string'));
			return;
		}

		const storedV3 = storedAny as StoredStateV3;
		if (storedV3.version === 3) {
			this.checked = new Map(
				(storedV3.checked ?? [])
					.filter((x) => x && typeof x.uri === 'string' && typeof x.id === 'string')
					.map((x) => [x.uri, x.id])
			);
			return;
		}

		const storedV2 = storedAny as StoredStateV2;
		if (storedV2.version !== 2) {
			return;
		}
		this.checked = new Map((storedV2.checked ?? []).map((uriStr) => [uriStr, generateCustomId('prt')]));
	}

	private async save(): Promise<void> {
		const stored: StoredStateV4 = {
			version: 4,
			checked: [...this.checked.entries()].map(([uri, id]) => ({ uri, id })),
			banned: [...this.banned]
		};
		await this.memento.update(STATE_KEY, stored);
	}
}
