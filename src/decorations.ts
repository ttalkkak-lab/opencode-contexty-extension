import * as vscode from 'vscode';
import { MirrorState } from './state';

export class MirrorDecorations implements vscode.FileDecorationProvider {
	private readonly emitter = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
	readonly onDidChangeFileDecorations = this.emitter.event;

	constructor(private readonly state: MirrorState) {}

	refresh(uris?: vscode.Uri | vscode.Uri[]): void {
		this.emitter.fire(uris);
	}

	provideFileDecoration(uri: vscode.Uri): vscode.ProviderResult<vscode.FileDecoration> {
		if (this.state.isChecked(uri)) {
			return {
				badge: '✓',
				tooltip: 'Checked (KCI Mirror)',
				color: new vscode.ThemeColor('problemsInfoIcon.foreground')
			};
		}

		return undefined;
	}
}
