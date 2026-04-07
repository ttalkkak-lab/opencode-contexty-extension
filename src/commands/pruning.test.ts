import { beforeAll, beforeEach, afterEach, describe, expect, mock, test } from 'bun:test';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

const registeredCommands = new Map<string, (...args: any[]) => unknown>();

mock.module('vscode', () => ({
	commands: {
		registerCommand: mock((name: string, handler: (...args: any[]) => unknown) => {
			registeredCommands.set(name, handler);
			return { dispose() {} };
		}),
		executeCommand: mock(async () => undefined),
	},
}));

let getTools: typeof import('./pruning.ts')['getTools'];
let getBlocks: typeof import('./pruning.ts')['getBlocks'];
let readPruningState: typeof import('./pruning.ts')['readPruningState'];
let writePruningState: typeof import('./pruning.ts')['writePruningState'];
let getPruneContainer: typeof import('./pruning.ts')['getPruneContainer'];
let resolveToolEntry: typeof import('./pruning.ts')['resolveToolEntry'];
let resolveBlockEntry: typeof import('./pruning.ts')['resolveBlockEntry'];
let registerPruningCommands: typeof import('./pruning.ts')['registerPruningCommands'];

beforeAll(async () => {
	({
		getTools,
		getBlocks,
		readPruningState,
		writePruningState,
		getPruneContainer,
		resolveToolEntry,
		resolveBlockEntry,
		registerPruningCommands,
	} = await import('./pruning.ts'));
});

describe('pruning command helpers', () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pruning-test-'));
		registeredCommands.clear();
	});

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	test('getTools with entry arrays returns the tuples', () => {
		const state = {
			prune: {
				tools: [
					['call_abc123', 8],
					['call_def456', 10],
				],
			},
		} as any;

		expect(getTools(state)).toEqual([
			['call_abc123', 8],
			['call_def456', 10],
		]);
	});

	test('getTools empty returns an empty array', () => {
		const state = { prune: { tools: [] } } as any;

		expect(getTools(state)).toEqual([]);
	});

	test('getBlocks from blocksById extracts blocks', () => {
		const state = {
			prune: {
				messages: {
					blocksById: [
						[1, { blockId: 1, active: true, topic: 'one', startId: 'm1', endId: 'm2', compressedTokens: 1, summaryTokens: 2, mode: 'range', createdAt: 1, summary: 'one' }],
						[2, { blockId: 2, active: true, topic: 'two', startId: 'm3', endId: 'm4', compressedTokens: 3, summaryTokens: 4, mode: 'range', createdAt: 2, summary: 'two' }],
					],
				},
			},
		} as any;

		expect(getBlocks(state)).toEqual([
			{ blockId: 1, active: true, topic: 'one', startId: 'm1', endId: 'm2', compressedTokens: 1, summaryTokens: 2, mode: 'range', createdAt: 1, summary: 'one' },
			{ blockId: 2, active: true, topic: 'two', startId: 'm3', endId: 'm4', compressedTokens: 3, summaryTokens: 4, mode: 'range', createdAt: 2, summary: 'two' },
		]);
	});

	test('getBlocks fallback to flat prune.blocks still works', () => {
		const state = { prune: { blocks: [{ blockId: 1, active: true, topic: 'legacy', startId: 'm1', endId: 'm2', compressedTokens: 1, summaryTokens: 2, mode: 'range', createdAt: 1, summary: 'legacy' }] } } as any;

		expect(getBlocks(state)).toEqual([
			{ blockId: 1, active: true, topic: 'legacy', startId: 'm1', endId: 'm2', compressedTokens: 1, summaryTokens: 2, mode: 'range', createdAt: 1, summary: 'legacy' },
		]);
	});

	test('restoreEntry write-back preserves tuple array format', async () => {
		const sessionId = 'ses_restore_entry';
		const filePath = path.join(tmpDir, '.contexty', 'sessions', sessionId, 'pruning-state.json');
		const state = {
			sessionId,
			prune: { tools: [['call_abc123', 8], ['call_def456', 10]] },
		} as any;

		await writePruningState(filePath, state);
		registerPruningCommands({ subscriptions: [] } as any, tmpDir, () => sessionId);

		await registeredCommands.get('contexty.pruning.restoreEntry')?.({ callId: 'call_abc123' });
		const next = await readPruningState(filePath);

		expect(next?.prune?.tools).toEqual([['call_def456', 10]]);
	});

	test('restoreAll write-back clears tools', async () => {
		const sessionId = 'ses_restore_all';
		const filePath = path.join(tmpDir, '.contexty', 'sessions', sessionId, 'pruning-state.json');
		await writePruningState(filePath, { sessionId, prune: { tools: [['call_abc123', 8]] } } as any);
		registerPruningCommands({ subscriptions: [] } as any, tmpDir, () => sessionId);

		await registeredCommands.get('contexty.pruning.restoreAll')?.();
		const next = await readPruningState(filePath);

		expect(next?.prune?.tools).toEqual([]);
	});

	test('decompressBlock write-back preserves blocksById tuple structure', async () => {
		const sessionId = 'ses_decompress_block';
		const filePath = path.join(tmpDir, '.contexty', 'sessions', sessionId, 'pruning-state.json');
		await writePruningState(filePath, {
			sessionId,
			prune: {
				messages: {
					blocksById: [[1, { blockId: 1, active: true, topic: 'one', startId: 'm1', endId: 'm2', compressedTokens: 1, summaryTokens: 2, mode: 'range', createdAt: 1, summary: 'one' }]],
				},
			},
		} as any);
		registerPruningCommands({ subscriptions: [] } as any, tmpDir, () => sessionId);

		await registeredCommands.get('contexty.pruning.decompressBlock')?.({ blockId: 1 });
		const next = await readPruningState(filePath);
		const blocksById = next?.prune?.messages?.blocksById as any;

		expect(blocksById?.[0]?.[1]?.active).toBe(false);
		expect(Array.isArray(blocksById?.[0])).toBe(true);
	});

	test('round-trip preserves entry-array format after mutation', async () => {
		const sessionId = 'ses_round_trip';
		const filePath = path.join(tmpDir, '.contexty', 'sessions', sessionId, 'pruning-state.json');
		const original = {
			sessionId,
			prune: {
				tools: [['call_abc123', 8]],
				messages: {
					blocksById: [[1, { blockId: 1, active: true, topic: 'one', startId: 'm1', endId: 'm2', compressedTokens: 1, summaryTokens: 2, mode: 'range', createdAt: 1, summary: 'one' }]],
				},
			},
		} as any;

		await writePruningState(filePath, original);
		const first = await readPruningState(filePath);
		first!.prune!.tools = [['call_abc123', 8], ['call_def456', 10]];
		getPruneContainer(first!);
		await writePruningState(filePath, first!);
		const next = await readPruningState(filePath);

		expect(next?.prune?.tools).toEqual([['call_abc123', 8], ['call_def456', 10]]);
		expect(next?.prune?.messages?.blocksById).toEqual(original.prune.messages.blocksById);
		expect(JSON.stringify(next)).toContain('blocksById');
	});

	test('resolve helpers accept object-shaped entries', () => {
		expect(resolveToolEntry({ callId: 'call_abc123' })).toEqual({ callId: 'call_abc123' });
		expect(resolveBlockEntry({ blockId: 1 })).toEqual({ blockId: 1 });
	});
});
