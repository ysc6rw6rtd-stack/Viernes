import { describe, expect, it } from 'vitest';
import { pickStartupModel } from './startup-model';

const available = ['google/gemma-3-12b-it', 'claude-opus-5-5', 'claude-haiku-5-5', 'gpt-5'];

describe('pickStartupModel', () => {
  it('starts on the configured Claude model instead of the recommendation', () => {
    expect(pickStartupModel({
      source: 'claude', configuredModel: 'claude-haiku-5-5',
      recommended: 'google/gemma-3-12b-it', current: '', available,
    })).toBe('claude-haiku-5-5');
  });

  it('replaces a stale non-Claude selection when the source is Claude', () => {
    expect(pickStartupModel({
      source: 'claude', configuredModel: undefined,
      recommended: 'google/gemma-3-12b-it', current: 'google/gemma-3-12b-it', available,
    })).toBe('claude-opus-5-5');
  });

  it('keeps a Claude model the user picked', () => {
    expect(pickStartupModel({
      source: 'claude', configuredModel: 'claude-opus-5-5',
      recommended: 'gpt-5', current: 'claude-haiku-5-5', available,
    })).toBe('claude-haiku-5-5');
  });

  it('keeps the old behaviour for local sources', () => {
    expect(pickStartupModel({
      source: 'ollama', configuredModel: undefined,
      recommended: 'qwen3.5:4b', current: '', available: ['qwen3.5:4b'],
    })).toBe('qwen3.5:4b');
  });
});
