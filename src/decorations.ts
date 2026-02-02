import * as vscode from 'vscode';
import { ContextState } from './state';

export class ContextDecorations implements vscode.FileDecorationProvider {
	private readonly emitter = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
	readonly onDidChangeFileDecorations = this.emitter.event;

	constructor(private readonly state: ContextState) {}

	refresh(uris?: vscode.Uri | vscode.Uri[]): void {
		this.emitter.fire(uris);
	}

	provideFileDecoration(uri: vscode.Uri): vscode.ProviderResult<vscode.FileDecoration> {
		if (this.state.isChecked(uri)) {
			return {
				badge: '✓',
				tooltip: 'Checked (Contexty)',
				color: new vscode.ThemeColor('problemsInfoIcon.foreground')
			};
		}

		return undefined;
	}
}
