// @ts-ignore bun:test is provided by the Bun runtime during test execution.
import { describe, expect, mock, test } from 'bun:test';
import type { CompressionBlockView, PruningSessionData } from './state.pruning';

mock.module('vscode', () => ({
	window: {},
	workspace: {},
	Uri: {
		file: (fsPath: string) => ({ scheme: 'file', fsPath }),
		parse: (value: string) => ({ scheme: 'file', fsPath: value }),
		joinPath: (_base: unknown, ...segments: string[]) => ({ scheme: 'file', fsPath: segments.join('/') }),
	},
}));

const { ContextState } = await import('./state');
const { countTokens: dcpCountTokens } = await import('../../opencode-contexty/src/dcp/token-utils');
const { countTokens: extensionCountTokens } = await import('./token-utils');

type PartLike = {
	callID: string;
	state: {
		output?: string;
	};
};

type TestContextState = {
	compactedParts: PartLike[];
	pruningData: PruningSessionData | null;
	partsByFile: Map<string, PartLike[]>;
	getPartTokens(part: PartLike): number;
	getTotalTokens(): number;
};

function createState(): TestContextState {
	return Object.create(ContextState.prototype) as TestContextState;
}

describe('token unification', () => {
	test('extension countTokens matches DCP countTokens for representative texts', () => {
		const texts = [
			'',
			'Hello world',
			'The quick brown fox jumps over the lazy dog.',
			'안녕하세요, world 🌍',
			'function test(value: string) { return value.trim().toLowerCase(); }',
			'Line one\nLine two\nLine three',
			'A'.repeat(512),
		];

		for (const text of texts) {
			expect(extensionCountTokens(text)).toBe(dcpCountTokens(text));
		}
	});

	test('getPartTokens uses summaryTokens for compacted parts', () => {
		const state = createState();
		const compactedPart: PartLike = {
			callID: 'call_compacted',
			state: {
				output: 'this output should be ignored when compacted',
				time: { compacted: true },
			},
		};
		const plainPart: PartLike = {
			callID: 'call_plain',
			state: {
				output: 'plain output text',
			},
		};
		const block: CompressionBlockView = {
			blockId: 1,
			topic: 'compact part',
			startId: 'm001',
			endId: 'm002',
			effectiveToolIds: ['call_compacted'],
			compressedTokens: 120,
			summaryTokens: 17,
			active: true,
			mode: 'range',
			createdAt: 1,
			summary: 'summary text',
		};

		state.compactedParts = [compactedPart];
		state.pruningData = {
			sessionId: 'ses_token_unification',
			entries: [],
			blocks: [block],
			totalPrunedTokens: 120,
			totalSummaryTokens: 17,
		};
		state.partsByFile = new Map([
			['file:///workspace/example.ts', [compactedPart, plainPart]],
		]);

		expect(state.getPartTokens(compactedPart)).toBe(block.summaryTokens);
		expect(state.getPartTokens(plainPart)).toBe(Math.round((plainPart.state.output ?? '').length / 4));
	});

	test('getTotalTokens stays consistent with CompressionBlockView summaryTokens', () => {
		const state = createState();
		const compactedPart: PartLike = {
			callID: 'call_compacted',
			state: {
				output: 'this output should not count',
				time: { compacted: true },
			},
		};
		const plainPart: PartLike = {
			callID: 'call_plain',
			state: {
				output: 'plain output',
			},
		};
		const block: CompressionBlockView = {
			blockId: 2,
			topic: 'aggregate',
			startId: 'm010',
			endId: 'm020',
			effectiveToolIds: ['call_compacted'],
			compressedTokens: 500,
			summaryTokens: 23,
			active: true,
			mode: 'range',
			createdAt: 2,
			summary: 'aggregate summary',
		};

		state.compactedParts = [compactedPart];
		state.pruningData = {
			sessionId: 'ses_total_tokens',
			entries: [],
			blocks: [block],
			totalPrunedTokens: 500,
			totalSummaryTokens: 23,
		};
		state.partsByFile = new Map([
			['file:///workspace/example.ts', [compactedPart, plainPart]],
		]);

		const expected = block.summaryTokens + Math.round((plainPart.state.output ?? '').length / 4);

		expect(state.getTotalTokens()).toBe(expected);
	});
});
