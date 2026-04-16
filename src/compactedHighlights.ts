import * as path from 'path';
import * as vscode from 'vscode';
import { ContextState } from './state';

function normalizeFsPath(fsPath: string): string {
	return path.normalize(fsPath).toLowerCase();
}

export class CompactedHighlights implements vscode.Disposable {
	private readonly decoration: vscode.TextEditorDecorationType;

	constructor(private readonly state: ContextState) {
		this.decoration = vscode.window.createTextEditorDecorationType({
			isWholeLine: true,
			backgroundColor: 'rgba(255, 0, 0, 0.22)'
		});
	}

	refreshAll(): void {
		for (const editor of vscode.window.visibleTextEditors) {
			this.applyToEditor(editor);
		}
	}

	private getCompactedFilePaths(): Set<string> {
		const compactedFilePaths = new Set<string>();
		for (const part of this.state.compactedParts) {
			const filePath = part.state?.input?.filePath;
			if (typeof filePath !== 'string' || filePath.length === 0) {
				continue;
			}
			compactedFilePaths.add(normalizeFsPath(filePath));
		}
		return compactedFilePaths;
	}

	private getFullDocumentRange(document: vscode.TextDocument): vscode.Range {
		if (document.lineCount === 0) {
			return new vscode.Range(0, 0, 0, 0);
		}

		const lastLine = document.lineCount - 1;
		const lastCharacter = document.lineAt(lastLine).range.end.character;
		return new vscode.Range(0, 0, lastLine, lastCharacter);
	}

	private applyToEditor(editor: vscode.TextEditor): void {
		if (editor.document.uri.scheme !== 'file') {
			return;
		}

		const compactedFilePaths = this.getCompactedFilePaths();
		if (!compactedFilePaths.has(normalizeFsPath(editor.document.uri.fsPath))) {
			editor.setDecorations(this.decoration, []);
			return;
		}

		editor.setDecorations(this.decoration, [this.getFullDocumentRange(editor.document)]);
	}

	dispose(): void {
		this.decoration.dispose();
	}
}
