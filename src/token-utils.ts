import * as _anthropicTokenizer from '@anthropic-ai/tokenizer';

const anthropicCountTokens = (
  _anthropicTokenizer.countTokens ?? (_anthropicTokenizer as any).default?.countTokens
) as typeof _anthropicTokenizer.countTokens;

export function countTokens(text: string): number {
  if (!text) return 0;
  try {
    return anthropicCountTokens(text);
  } catch {
    return Math.round(text.length / 4);
  }
}
