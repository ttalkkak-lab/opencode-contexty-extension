// @ts-ignore bun:test is provided by the Bun runtime during test execution.
import { describe, expect, mock, test } from 'bun:test';

mock.module('vscode', () => {
	class Range {
		constructor(
			public readonly startLine: number,
			public readonly startCharacter: number,
			public readonly endLine: number,
			public readonly endCharacter: number
		) {}
	}

	const createTextEditorDecorationType = mock(() => ({ dispose() {} }));

	return {
		Range,
		window: {
			visibleTextEditors: [],
			createTextEditorDecorationType,
		},
	};
});

const vscode = await import('vscode');
const { CompactedHighlights } = await import('./compactedHighlights');

describe('CompactedHighlights', () => {
	test('decorates visible editors for compacted files', () => {
		const setDecorations = mock(() => undefined);
		const editor = {
			document: {
				uri: { scheme: 'file', fsPath: '/workspace/src/app.ts' },
				lineCount: 3,
				lineAt: (line: number) => ({ range: { end: { character: line === 2 ? 11 : 0 } } }),
			},
			setDecorations,
		};
		(vscode.window.visibleTextEditors as unknown as typeof editor[]) = [editor];

		const state = {
			compactedParts: [{ state: { input: { filePath: '/workspace/src/app.ts' } } }],
		} as any;

		const highlights = new CompactedHighlights(state);
		highlights.refreshAll();

		expect(setDecorations).toHaveBeenCalledTimes(1);
		expect(setDecorations.mock.calls[0][1]).toHaveLength(1);
		expect(setDecorations.mock.calls[0][1][0]).toMatchObject({ startLine: 0, endLine: 2 });
	});

	test('clears decorations for non-compacted editors', () => {
		const setDecorations = mock(() => undefined);
		const editor = {
			document: {
				uri: { scheme: 'file', fsPath: '/workspace/src/other.ts' },
				lineCount: 1,
				lineAt: () => ({ range: { end: { character: 5 } } }),
			},
			setDecorations,
		};
		(vscode.window.visibleTextEditors as unknown as typeof editor[]) = [editor];

		const state = {
			compactedParts: [{ state: { input: { filePath: '/workspace/src/app.ts' } } }],
		} as any;

		const highlights = new CompactedHighlights(state);
		highlights.refreshAll();

		expect(setDecorations).toHaveBeenCalledWith(expect.anything(), []);
	});
});
