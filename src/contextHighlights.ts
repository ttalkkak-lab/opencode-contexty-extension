import * as vscode from 'vscode';
import { ContextState } from './state';

export class ContextHighlights implements vscode.Disposable {
	private readonly decoration: vscode.TextEditorDecorationType;

	constructor(private readonly state: ContextState) {
		this.decoration = vscode.window.createTextEditorDecorationType({
			isWholeLine: true,
			backgroundColor: 'rgba(120, 190, 255, 0.18)'
		});
	}

	refreshAll(): void {
		for (const editor of vscode.window.visibleTextEditors) {
			this.applyToEditor(editor);
		}
	}

	private applyToEditor(editor: vscode.TextEditor): void {
		if (editor.document.uri.scheme !== 'file') {
			return;
		}
		const ranges = this.state
			.getLineRangesForFile(editor.document.uri)
			.map((range) => new vscode.Range(range.start, 0, range.end, 0));
		editor.setDecorations(this.decoration, ranges);
	}

	dispose(): void {
		this.decoration.dispose();
	}
}
