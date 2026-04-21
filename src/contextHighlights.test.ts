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
const { ContextHighlights } = await import('./contextHighlights');

describe('ContextHighlights', () => {
	test('skips redundant decoration updates when ranges do not change', () => {
		const setDecorations = mock(() => undefined);
		const editor = {
			document: {
				uri: { scheme: 'file', fsPath: '/workspace/src/app.ts' },
			},
			setDecorations,
		};
		(vscode.window.visibleTextEditors as unknown as typeof editor[]) = [editor];

		let ranges = [{ start: 1, end: 3 }];
		const state = {
			getLineRangesForFile: mock(() => ranges),
		} as any;

		const highlights = new ContextHighlights(state);
		highlights.refreshAll();
		highlights.refreshAll();
		ranges = [{ start: 1, end: 4 }];
		highlights.refreshAll();

		expect(setDecorations).toHaveBeenCalledTimes(2);
		expect(setDecorations.mock.calls[0][1][0]).toMatchObject({ startLine: 1, endLine: 3 });
		expect(setDecorations.mock.calls[1][1][0]).toMatchObject({ startLine: 1, endLine: 4 });
	});
});
