import { expect, test } from 'vitest';

import { BindingKind, OriginKind, SessionTarget } from '../constants';
import { makeModel } from '../fixtures';
import { ManualTaskPolicy } from './manualPolicy';

test('ManualPolicy.toWireBinding: new_session -> main + null', () => {
  const policy = new ManualTaskPolicy();
  const result = policy.toWireBinding({ kind: BindingKind.NewSession });
  expect(result).toEqual({ sessionTarget: SessionTarget.Main, sessionKey: null });
});

test('ManualPolicy.toWireBinding: ui_session with sessionId -> main + managed key', () => {
  const policy = new ManualTaskPolicy();
  const result = policy.toWireBinding({ kind: BindingKind.UISession, sessionId: 'sess-x' });
  expect(result.sessionTarget).toBe(SessionTarget.Main);
  expect(result.sessionKey).toBe('zhiyuan:sess-x');
});

test('ManualPolicy.toWireBinding: session_key with custom key -> isolated + original key', () => {
  const policy = new ManualTaskPolicy();
  const result = policy.toWireBinding({ kind: BindingKind.SessionKey, sessionKey: 'custom:key:1' });
  expect(result.sessionTarget).toBe(SessionTarget.Isolated);
  expect(result.sessionKey).toBe('custom:key:1');
});

test('ManualPolicy.describeRunBehavior: new_session -> returns description', () => {
  const policy = new ManualTaskPolicy();
  const draft = makeModel({
    origin: { kind: OriginKind.Manual },
    binding: { kind: BindingKind.NewSession },
  });
  const desc = policy.describeRunBehavior(draft);
  expect(typeof desc === 'string' && desc.length > 0).toBeTruthy();
});

test('ManualPolicy.describeRunBehavior: ui_session -> returns description', () => {
  const policy = new ManualTaskPolicy();
  const draft = makeModel({
    origin: { kind: OriginKind.Manual },
    binding: { kind: BindingKind.UISession, sessionId: 's1' },
  });
  const desc = policy.describeRunBehavior(draft);
  expect(typeof desc === 'string' && desc.length > 0).toBeTruthy();
});

test('ManualPolicy.describeRunBehavior: session_key returns a description', () => {
  const policy = new ManualTaskPolicy();
  const draft = makeModel({
    origin: { kind: OriginKind.Manual },
    binding: { kind: BindingKind.SessionKey, sessionKey: 'k1' },
  });
  const desc = policy.describeRunBehavior(draft);
  expect(typeof desc === 'string' && desc.length > 0).toBeTruthy();
});

test('ManualPolicy.getReadonlyFields: returns empty array', () => {
  const policy = new ManualTaskPolicy();
  const fields = policy.getReadonlyFields();
  expect(fields).toEqual([]);
});
