import * as vscode from 'vscode';

export class SelectionLensProvider implements vscode.CodeLensProvider {
	private readonly changeEmitter = new vscode.EventEmitter<void>();
	readonly onDidChangeCodeLenses = this.changeEmitter.event;

	private readonly selectionByUri = new Map<string, vscode.Selection>();

	updateSelection(uri: vscode.Uri, selection: vscode.Selection | undefined): void {
		const key = uri.toString();
		if (!selection || selection.isEmpty) {
			if (this.selectionByUri.delete(key)) {
				this.changeEmitter.fire();
			}
			return;
		}
		this.selectionByUri.set(key, selection);
		this.changeEmitter.fire();
	}

	clearSelection(uri: vscode.Uri): void {
		const key = uri.toString();
		if (this.selectionByUri.delete(key)) {
			this.changeEmitter.fire();
		}
	}

	provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
		const selection = this.selectionByUri.get(document.uri.toString());
		if (!selection || selection.isEmpty) {
			return [];
		}
		const range = new vscode.Range(selection.start.line, 0, selection.start.line, 0);
		const command: vscode.Command = {
			command: 'kciMirror.addSelectionToContext',
			title: 'Add to Context',
			arguments: [document.uri, selection]
		};
		return [new vscode.CodeLens(range, command)];
	}
}
