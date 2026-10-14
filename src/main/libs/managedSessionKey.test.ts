import { expect, test } from 'vitest';
import {
  buildManagedSessionKey,
  isManagedSessionKey,
  parseManagedSessionKey,
} from './managedSessionKey';

test('managed session keys preserve application session IDs containing colons', () => {
  const key = buildManagedSessionKey('session:with:colons');
  expect(key).toBe('zhiyuan:session:with:colons');
  expect(parseManagedSessionKey(key)).toEqual({ sessionId: 'session:with:colons' });
  expect(isManagedSessionKey(key)).toBe(true);
});

test('rejects missing or unrelated session identifiers', () => {
  expect(parseManagedSessionKey(undefined)).toBeNull();
  expect(parseManagedSessionKey('')).toBeNull();
  expect(parseManagedSessionKey('zhiyuan:')).toBeNull();
  expect(parseManagedSessionKey('other:session')).toBeNull();
});
