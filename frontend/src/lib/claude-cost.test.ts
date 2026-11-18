import { describe, expect, it } from 'vitest';
import { estimateClaudeCost, friendlyChatError, isClaudeModel } from './claude-cost';

describe('claude cost', () => {
  it('estimates spend from token counts', () => {
    expect(estimateClaudeCost('claude-opus-5-5', 1_000_000, 100_000)).toBeCloseTo(6);
    expect(estimateClaudeCost('claude-haiku-5-5', 10_000, 1_000)).toBeCloseTo(0.0015);
    expect(estimateClaudeCost('gpt-5', 1, 1)).toBeNull();
  });

  it('recognises Claude models', () => {
    expect(isClaudeModel('claude-sonnet-5-5')).toBe(true);
    expect(isClaudeModel('google/gemma-3-12b-it')).toBe(false);
  });

  it('explains billing and key problems in Spanish', () => {
    expect(friendlyChatError('Error code: 400 - Your credit balance is too low')).toMatch(/sin saldo/);
    expect(friendlyChatError('Error code: 401 - invalid x-api-key')).toMatch(/clave de Claude/);
    expect(friendlyChatError('Error code: 529 - overloaded_error')).toMatch(/saturado/);
    expect(friendlyChatError('something else')).toBe('something else');
  });

  it('points to the model picker when a non-Claude model is unauthorized', () => {
    const msg = friendlyChatError(
      "Client error '401 Unauthorized' for url 'https://integrate.api.nvidia.com/v1/chat/completions'",
      'google/gemma-3-12b-it',
    );
    expect(msg).toMatch(/no es de Claude/);
    expect(msg).toMatch(/claude-opus-5-5/);
  });
});
