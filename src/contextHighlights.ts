import * as vscode from 'vscode';
import { MirrorState } from './state';

export class MirrorContextHighlights implements vscode.Disposable {
	private readonly decoration: vscode.TextEditorDecorationType;

	constructor(private readonly state: MirrorState) {
		this.decoration = vscode.window.createTextEditorDecorationType({
			isWholeLine: true,
			borderStyle: 'solid',
			borderWidth: '0 0 0 3px',
			borderColor: new vscode.ThemeColor('editorGutter.modifiedBackground')
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
