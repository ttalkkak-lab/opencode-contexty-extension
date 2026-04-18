import * as anthropicTokenizerModule from '@anthropic-ai/tokenizer';

type AnthropicTokenizerModule = typeof import('@anthropic-ai/tokenizer') & {
  default?: typeof import('@anthropic-ai/tokenizer');
};

const anthropicCountTokens = (
  (anthropicTokenizerModule as AnthropicTokenizerModule).countTokens
  ?? (anthropicTokenizerModule as AnthropicTokenizerModule).default?.countTokens
) as typeof anthropicTokenizerModule.countTokens;

export function countTokens(text: string): number {
  if (!text) {
    return 0;
  }
  try {
    return anthropicCountTokens(text);
  } catch {
    return Math.round(text.length / 4);
  }
}
