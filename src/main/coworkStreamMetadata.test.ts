import { expect, test } from 'vitest';
import { getCoworkStreamMetadata } from './coworkStreamMetadata';

test('content updates preserve final flags and bounded tool previews without attachment bytes', () => {
  const metadata = {
    isFinal: true,
    isFinalAnswer: true,
    isThinking: false,
    usage: { totalTokens: 120 },
    contextUsage: { usedTokens: 100, contextWindowTokens: 1000 },
    metrics: { toolDurationMs: 50 },
    imageAttachments: [{ base64Data: 'x'.repeat(1_000_000) }],
    toolInput: { content: 'x'.repeat(1_000_000) },
    toolResult: 'x'.repeat(1_000_000),
  };
  const result = getCoworkStreamMetadata(metadata);
  expect(result).toMatchObject({
    isFinal: true,
    isFinalAnswer: true,
    isThinking: false,
    usage: { totalTokens: 120 },
    contextUsage: { usedTokens: 100, contextWindowTokens: 1000 },
    metrics: { toolDurationMs: 50 },
    toolInputTruncated: true,
  });
  expect(result).not.toHaveProperty('imageAttachments');
  expect(result).not.toHaveProperty('toolResult');
  expect(JSON.stringify(result).length).toBeLessThan(9_000);
  expect(JSON.stringify(result)).toContain('[truncated]');
  expect(getCoworkStreamMetadata(result)?.toolInputTruncated).toBe(true);
});

test('native tool argument revisions retain actual small inputs and tool identity', () => {
  expect(
    getCoworkStreamMetadata({
      toolUseId: 'call',
      toolName: 'bash',
      toolInput: { command: 'pwd', nested: { value: [1, true] } },
    }),
  ).toEqual({
    toolUseId: 'call',
    toolName: 'bash',
    toolInput: { command: 'pwd', nested: { value: [1, true] } },
    toolInputTruncated: false,
  });
});

test('wide, deep and circular model arguments have bounded traversal and output', () => {
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  for (const toolInput of [
    { items: Array.from({ length: 100_000 }, () => 1) },
    { a: { b: { c: { d: { e: 'too deep' } } } } },
    circular,
  ]) {
    const result = getCoworkStreamMetadata({ toolInput });
    expect(result?.toolInputTruncated).toBe(true);
    expect(JSON.stringify(result).length).toBeLessThan(9_000);
  }
});

test('the main-process preview visits at most the fixed node budget', () => {
  let reads = 0;
  const values = Array.from({ length: 10_000 }, () => ({ value: 1 }));
  const input = new Proxy(values, {
    get(target, key, receiver) {
      if (typeof key === 'string' && /^\d+$/.test(key)) reads++;
      return Reflect.get(target, key, receiver);
    },
  });
  getCoworkStreamMetadata({ toolInput: { values: input } });
  expect(reads).toBeLessThan(128);
});
