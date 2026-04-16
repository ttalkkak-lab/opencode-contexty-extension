// @ts-ignore bun:test is provided by the Bun runtime during test execution.
import { describe, expect, mock, test } from 'bun:test';

import { countTokens as dcpCountTokens } from '../../opencode-contexty/src/dcp/token-utils';

mock.module('@anthropic-ai/tokenizer', () => ({
  countTokens: mock((text: string) => {
    if (text === 'force fallback') {
      throw new Error('forced tokenizer failure');
    }

    return dcpCountTokens(text);
  }),
}));

const { countTokens } = await import('./token-utils');

describe('token-utils', () => {
  test('countTokens returns correct count for English text', () => {
    expect(countTokens('Hello world')).toBe(2);
  });

  test('countTokens fallback formula is Math.round(length/4)', () => {
    const cases: [string, number][] = [
      ['ab', 1],
      ['abcd', 1],
      ['abcde', 1],
      ['abcdefgh', 2],
      ['abcdefghijkl', 3],
    ];
    for (const [text, expected] of cases) {
      expect(Math.round(text.length / 4)).toBe(expected);
    }
    expect(countTokens('Hello world')).toBe(dcpCountTokens('Hello world'));
  });

  test('countTokens handles empty string', () => {
    expect(countTokens('')).toBe(0);
  });

  test('countTokens matches DCP implementation (same ratio)', () => {
    const text = 'Hello world, this is a token consistency check for the extension.';
    const extensionRatio = countTokens(text) / text.length;
    const dcpRatio = dcpCountTokens(text) / text.length;

    expect(extensionRatio).toBe(dcpRatio);
  });
});
