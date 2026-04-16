export interface PruningEntry {
	callId: string;
	tool: string;
	turn: number;
	reason: 'deduplication' | 'purge-errors';
	tokenCount?: number;
	error?: string;
}

export interface CompressionBlockView {
	blockId: number;
	topic: string;
	startId: string;
	endId: string;
	effectiveToolIds: string[];
	compressedTokens: number;
	summaryTokens: number;
	active: boolean;
	mode: string;
	createdAt: number;
	summary: string;
}

export interface PruningSessionData {
	sessionId: string;
	entries: PruningEntry[];
	blocks: CompressionBlockView[];
	totalPrunedTokens: number;
	totalSummaryTokens: number;
	prune?: {
		toolIdList?: string[];
	};
}

export type SerializedPruningSessionData = {
	sessionId?: unknown;
	entries?: unknown;
	blocks?: unknown;
	totalPrunedTokens?: unknown;
	totalSummaryTokens?: unknown;
	toolIdList?: unknown[];
	prune?: {
		entries?: unknown;
		blocks?: unknown;
		messages?: {
			blocksById?: unknown[];
			[key: string]: unknown;
		};
		totalPrunedTokens?: unknown;
		totalSummaryTokens?: unknown;
		[key: string]: unknown;
	};
	stats?: { totalPruneTokens?: number; [key: string]: unknown };
	toolParameters?: unknown[];
	[key: string]: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

function toString(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

function toNumber(value: unknown): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function toBoolean(value: unknown): boolean {
	return typeof value === 'boolean' ? value : false;
}

function toStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.filter((item): item is string => typeof item === 'string');
}

function normalizeReason(value: unknown): PruningEntry['reason'] {
	return value === 'purge-errors' ? 'purge-errors' : 'deduplication';
}

function deserializePruningEntry(value: unknown): PruningEntry | null {
	if (!isRecord(value)) {
		return null;
	}

	const callId = toString(value.callId ?? value.callID);
	const tool = toString(value.tool);
	const turn = toNumber(value.turn);
	if (!callId || !tool || turn < 0) {
		return null;
	}

	const entry: PruningEntry = {
		callId,
		tool,
		turn,
		reason: normalizeReason(value.reason),
	};

	if (typeof value.tokenCount === 'number' && Number.isFinite(value.tokenCount)) {
		entry.tokenCount = value.tokenCount;
	}

	if (typeof value.error === 'string' && value.error.length > 0) {
		entry.error = value.error;
	}

	return entry;
}

function deserializeCompressionBlockView(value: unknown): CompressionBlockView | null {
	if (!isRecord(value)) {
		return null;
	}

	const blockId = toNumber(value.blockId);
	const topic = toString(value.topic);
	const startId = toString(value.startId);
	const endId = toString(value.endId);
	if (blockId < 0 || !topic || !startId || !endId) {
		return null;
	}

	return {
		blockId,
		topic,
		startId,
		endId,
		effectiveToolIds: toStringArray(value.effectiveToolIds),
		compressedTokens: toNumber(value.compressedTokens),
		summaryTokens: toNumber(value.summaryTokens),
		active: toBoolean(value.active),
		mode: toString(value.mode) || 'range',
		createdAt: toNumber(value.createdAt),
		summary: toString(value.summary),
	};
}

function parseToolTuple(value: unknown): [string, number] | null {
	if (!Array.isArray(value) || value.length !== 2) return null;
	const [callId, turn] = value;
	if (typeof callId !== 'string' || typeof turn !== 'number') return null;
	return [callId, turn];
}

function parseBlockTuple(value: unknown): [number, unknown] | null {
	if (!Array.isArray(value) || value.length !== 2) return null;
	const [id, block] = value;
	if (typeof id !== 'number' || !isRecord(block)) return null;
	return [id, block];
}

function parseToolParamTuple(value: unknown): [string, Record<string, unknown>] | null {
	if (!Array.isArray(value) || value.length !== 2) return null;
	const [callId, params] = value;
	if (typeof callId !== 'string' || !isRecord(params)) return null;
	return [callId, params];
}

export function deserializePruningSessionData(raw: SerializedPruningSessionData): PruningSessionData | null {
	const source = isRecord(raw.prune) ? raw.prune : raw;
	const sessionId = toString(source.sessionId ?? raw.sessionId);
	if (!sessionId) {
		return null;
	}

	let blocks: CompressionBlockView[] = [];
	const messages = isRecord(source.messages) ? source.messages : null;
	if (messages && Array.isArray(messages.blocksById)) {
		for (const item of messages.blocksById) {
			const tuple = parseBlockTuple(item);
			if (!tuple) continue;
			const block = deserializeCompressionBlockView(tuple[1]);
			if (block) blocks.push(block);
		}
	}

	if (blocks.length === 0 && Array.isArray(source.blocks)) {
		blocks = source.blocks
			.map((block) => deserializeCompressionBlockView(block))
			.filter((block): block is CompressionBlockView => block !== null);
	}

	const toolParamsMap = new Map<string, Record<string, unknown>>();
	if (Array.isArray(raw.toolParameters)) {
		for (const item of raw.toolParameters) {
			const tuple = parseToolParamTuple(item);
			if (tuple) toolParamsMap.set(tuple[0], tuple[1]);
		}
	}

	const entries: PruningEntry[] = [];
	if (Array.isArray(source.tools)) {
		for (const item of source.tools) {
			const tuple = parseToolTuple(item);
			if (!tuple) continue;
			const [callId, turn] = tuple;
			const params = toolParamsMap.get(callId);
			const tool = params ? toString(params.tool) : '';
			const status = params ? toString(params.status) : '';
			const entry: PruningEntry = {
				callId,
				tool,
				turn,
				reason: status === 'error' ? 'purge-errors' : 'deduplication',
			};

			if (typeof params?.tokenCount === 'number' && Number.isFinite(params.tokenCount)) {
				entry.tokenCount = params.tokenCount;
			}

			if (status === 'error' && typeof params?.error === 'string' && params.error.length > 0) {
				entry.error = params.error;
			}

			entries.push(entry);
		}
	} else if (Array.isArray(source.entries)) {
		entries.push(
			...source.entries
				.map((entry) => deserializePruningEntry(entry))
				.filter((entry): entry is PruningEntry => entry !== null),
		);
	}

	const stats = isRecord(raw.stats) ? raw.stats : null;
	const totalPrunedTokens = typeof stats?.totalPruneTokens === 'number'
		? stats.totalPruneTokens
		: typeof source.totalPrunedTokens === 'number'
			? source.totalPrunedTokens
			: entries.reduce((sum, entry) => sum + (entry.tokenCount ?? 0), 0);
	const totalSummaryTokens = typeof source.totalSummaryTokens === 'number'
		? source.totalSummaryTokens
		: blocks.reduce((sum, block) => sum + block.summaryTokens, 0);

	const toolIdList = Array.isArray(raw.toolIdList)
		? raw.toolIdList.filter((id: unknown): id is string => typeof id === 'string')
		: undefined;

	return {
		sessionId,
		entries,
		blocks,
		totalPrunedTokens,
		totalSummaryTokens,
		prune: toolIdList ? { toolIdList } : undefined,
	};
}
