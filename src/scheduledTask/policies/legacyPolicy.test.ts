import { expect, test } from 'vitest';

import { BindingKind, OriginKind, SessionTarget, WakeMode } from '../constants';
import { makeModel } from '../fixtures';
import { LegacyTaskPolicy } from './legacyPolicy';

test('LegacyPolicy.getCreateDefaults: returns sessionTarget main + next-heartbeat wakeMode', () => {
  const policy = new LegacyTaskPolicy();
  const defaults = policy.getCreateDefaults();
  expect(defaults.sessionTarget).toBe(SessionTarget.Main);
  expect(defaults.wakeMode).toBe(WakeMode.NextHeartbeat);
});

test('LegacyPolicy.toWireBinding: any binding -> always returns sessionTarget main + null sessionKey', () => {
  const policy = new LegacyTaskPolicy();

  const wireNew = policy.toWireBinding({ kind: BindingKind.NewSession });
  expect(wireNew.sessionTarget).toBe(SessionTarget.Main);
  expect(wireNew.sessionKey).toBe(null);

  const wireSessionKey = policy.toWireBinding({
    kind: BindingKind.SessionKey,
    sessionKey: 'custom:key',
  });
  expect(wireSessionKey.sessionTarget).toBe(SessionTarget.Main);
  expect(wireSessionKey.sessionKey).toBe(null);
});

test('LegacyPolicy.describeRunBehavior: returns non-empty string', () => {
  const policy = new LegacyTaskPolicy();
  const draft = makeModel({ origin: { kind: OriginKind.Legacy } });
  const desc = policy.describeRunBehavior(draft);
  expect(typeof desc === 'string' && desc.length > 0).toBeTruthy();
});

test('LegacyPolicy.getReadonlyFields: contains origin', () => {
  const policy = new LegacyTaskPolicy();
  const fields = policy.getReadonlyFields();
  expect(fields.includes('origin')).toBeTruthy();
});
