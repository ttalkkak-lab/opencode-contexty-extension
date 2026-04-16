// @ts-ignore bun:test is provided by the Bun runtime during test execution.
import { describe, expect, test } from 'bun:test';
import { deserializePruningSessionData } from './state.pruning';

describe('deserializePruningSessionData', () => {
	test('parses real tuple-based pruning state with entries, blocks, and totals', () => {
		const data = deserializePruningSessionData({
			sessionId: 'ses_test123',
			prune: {
				tools: [
					['call_abc123', 8],
					['call_def456', 10],
				],
				messages: {
					blocksById: [
						[
							1,
							{
								blockId: 1,
								active: true,
								compressedTokens: 1000,
								summaryTokens: 50,
								topic: 'test topic',
								startId: 'm001',
								endId: 'm005',
								mode: 'range',
								createdAt: 1234567890,
								summary: 'Test summary',
							},
						],
					],
				},
			},
			stats: { totalPruneTokens: 5000 },
			toolParameters: [
				['call_abc123', { tool: 'read', status: 'completed', turn: 8 }],
				['call_def456', { tool: 'write', status: 'error', turn: 10, error: 'file not found' }],
			],
		} as any);

		expect(data).not.toBeNull();
		expect(data?.blocks.length).toBe(1);
		expect(data?.entries.length).toBe(2);
		expect(data?.totalPrunedTokens).toBe(5000);
		expect(data?.totalSummaryTokens).toBe(50);
		expect(data?.entries[0]).toMatchObject({ tool: 'read', callId: 'call_abc123', turn: 8, reason: 'deduplication' });
		expect(data?.entries[1]).toMatchObject({ reason: 'purge-errors', error: 'file not found' });
	});

	test('returns empty collections for empty pruning data', () => {
		const data = deserializePruningSessionData({
			sessionId: 'ses_empty',
			prune: { tools: [], messages: { blocksById: [] } },
		} as any);

		expect(data).not.toBeNull();
		expect(data?.entries).toEqual([]);
		expect(data?.blocks).toEqual([]);
		expect(data?.totalPrunedTokens).toBe(0);
		expect(data?.totalSummaryTokens).toBe(0);
	});

	test('defaults totalPrunedTokens to zero when stats are missing', () => {
		const data = deserializePruningSessionData({
			sessionId: 'ses_missing_stats',
			prune: { tools: [], messages: { blocksById: [] } },
		} as any);

		expect(data?.totalPrunedTokens).toBe(0);
	});

	test('joins unmatched tool calls into entries with empty tool names', () => {
		const data = deserializePruningSessionData({
			sessionId: 'ses_unmatched',
			prune: { tools: [['call_xyz', 5]], messages: { blocksById: [] } },
			toolParameters: [],
		} as any);

		expect(data?.entries).toHaveLength(1);
		expect(data?.entries[0]).toMatchObject({ callId: 'call_xyz', turn: 5, tool: '', reason: 'deduplication' });
	});

	test('sums totalSummaryTokens from parsed blocks', () => {
		const data = deserializePruningSessionData({
			sessionId: 'ses_summary_tokens',
			prune: {
				tools: [],
				messages: {
					blocksById: [
						[1, { blockId: 1, topic: 'a', startId: 'm001', endId: 'm002', compressedTokens: 10, summaryTokens: 50, active: true, mode: 'range', createdAt: 1, summary: 'a' }],
						[2, { blockId: 2, topic: 'b', startId: 'm003', endId: 'm004', compressedTokens: 20, summaryTokens: 100, active: true, mode: 'range', createdAt: 2, summary: 'b' }],
					],
				},
			},
		} as any);

		expect(data?.totalSummaryTokens).toBe(150);
	});

		test('parses tuple-based block entries into CompressionBlockView values', () => {
			const data = deserializePruningSessionData({
				sessionId: 'ses_blocks',
				prune: {
					tools: [],
					messages: {
						blocksById: [
							[1, { blockId: 1, topic: 'x', startId: 'm001', endId: 'm002', effectiveToolIds: ['call_1'], compressedTokens: 11, summaryTokens: 22, active: true, mode: 'range', createdAt: 3, summary: 'x' }],
							[2, { blockId: 2, topic: 'y', startId: 'm003', endId: 'm004', effectiveToolIds: [], compressedTokens: 33, summaryTokens: 44, active: false, mode: 'range', createdAt: 4, summary: 'y' }],
						],
					},
				},
			} as any);

			expect(data?.blocks).toHaveLength(2);
			expect(data?.blocks[0]).toMatchObject({ blockId: 1, topic: 'x', startId: 'm001', endId: 'm002', effectiveToolIds: ['call_1'], compressedTokens: 11, summaryTokens: 22, active: true });
			expect(data?.blocks[1]).toMatchObject({ blockId: 2, topic: 'y', startId: 'm003', endId: 'm004', effectiveToolIds: [], compressedTokens: 33, summaryTokens: 44, active: false });
		});

		test('keeps only string effectiveToolIds when deserializing blocks', () => {
			const data = deserializePruningSessionData({
				sessionId: 'ses_effective_ids',
				prune: {
					tools: [],
					messages: {
						blocksById: [[1, { blockId: 1, topic: 'x', startId: 'm001', endId: 'm002', effectiveToolIds: ['call_1', 2, null], compressedTokens: 1, summaryTokens: 1, active: true, mode: 'range', createdAt: 1, summary: 'x' }]],
					},
				},
			} as any);

			expect(data?.blocks[0].effectiveToolIds).toEqual(['call_1']);
		});

	test('builds deduplication entries from matching tools and toolParameters', () => {
		const data = deserializePruningSessionData({
			sessionId: 'ses_dedup',
			prune: { tools: [['call_aaa', 3]], messages: { blocksById: [] } },
			toolParameters: [['call_aaa', { tool: 'grep', status: 'completed', turn: 3 }]],
		} as any);

		expect(data?.entries[0]).toMatchObject({ tool: 'grep', reason: 'deduplication', turn: 3, callId: 'call_aaa' });
	});

	test('parses purge error entries from toolParameters', () => {
		const data = deserializePruningSessionData({
			sessionId: 'ses_error',
			prune: { tools: [['call_err', 4]], messages: { blocksById: [] } },
			toolParameters: [['call_err', { tool: 'write', status: 'error', turn: 4, error: 'boom' }]],
		} as any);

		expect(data?.entries[0]).toMatchObject({ tool: 'write', reason: 'purge-errors', error: 'boom' });
	});

	test('keeps backward compatibility with flat prune.blocks arrays', () => {
		const data = deserializePruningSessionData({
			sessionId: 'ses_legacy_blocks',
			prune: {
				tools: [],
				blocks: [
					{ blockId: 1, topic: 'old', startId: 'm001', endId: 'm002', compressedTokens: 1, summaryTokens: 2, active: true, mode: 'range', createdAt: 5, summary: 'legacy' },
				],
			},
		} as any);

		expect(data?.blocks).toHaveLength(1);
		expect(data?.blocks[0]).toMatchObject({ blockId: 1, topic: 'old' });
	});
});
