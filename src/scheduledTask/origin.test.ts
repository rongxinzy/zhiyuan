import { expect, test } from 'vitest';

import { BindingKind, OriginKind } from './constants';
import { makeTask } from './fixtures';
import { inferOriginAndBinding } from './origin';

test('infer: unknown sessionKey format -> session_key binding fallback', () => {
  const result = inferOriginAndBinding(makeTask({ sessionKey: 'custom:opaque:key:value' }));
  expect(result.origin.kind).toBe(OriginKind.Cowork);
  expect((result.origin as any).sessionId).toBe('');
  expect(result.binding.kind).toBe(BindingKind.SessionKey);
  expect((result.binding as any).sessionKey).toBe('custom:opaque:key:value');
});

test('infer: null sessionKey -> manual origin + new_session binding', () => {
  const result = inferOriginAndBinding(makeTask({ sessionKey: null }));
  expect(result.origin).toEqual({ kind: OriginKind.Manual });
  expect(result.binding).toEqual({ kind: BindingKind.NewSession });
});

test('infer: undefined sessionKey -> manual origin', () => {
  const result = inferOriginAndBinding(makeTask({ sessionKey: undefined }));
  expect(result.origin).toEqual({ kind: OriginKind.Manual });
  expect(result.binding).toEqual({ kind: BindingKind.NewSession });
});

test('infer: empty string sessionKey -> manual origin', () => {
  const result = inferOriginAndBinding(makeTask({ sessionKey: '' }));
  expect(result.origin).toEqual({ kind: OriginKind.Manual });
  expect(result.binding).toEqual({ kind: BindingKind.NewSession });
});

test('infer: sessionKey with whitespace is trimmed before parsing', () => {
  const result = inferOriginAndBinding(makeTask({ sessionKey: '  zhiyuan:sess-trimmed  ' }));
  expect(result.origin.kind).toBe(OriginKind.Cowork);
  expect((result.origin as any).sessionId).toBe('sess-trimmed');
});

test('infer: pure function - same input, same output', () => {
  const task = makeTask({ sessionKey: 'zhiyuan:sess-stable' });
  const r1 = inferOriginAndBinding(task);
  const r2 = inferOriginAndBinding(task);
  expect(r1).toEqual(r2);
});
