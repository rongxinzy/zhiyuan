import Database from 'better-sqlite3';
import { expect, test } from 'vitest';

import { BindingKind, OriginKind, PayloadKind, ScheduleKind } from './constants';
import { makeModel, makeTask } from './fixtures';
import { ScheduledTaskMetaStore } from './metaStore';
import { TaskModelMapper } from './modelMapper';
import { taskPolicyRegistry } from './policies/registry';

const mapper = new TaskModelMapper();

function createMetaStore() {
  const db = new Database(':memory:');
  return new ScheduledTaskMetaStore(db);
}

test('integration: infer -> persist -> reload uses stored meta (not re-infer)', () => {
  const metaStore = createMetaStore();
  const wire = makeTask({ sessionKey: 'zhiyuan:sess-99' });

  // 1. First load -- infer
  const model1 = mapper.fromWire(wire);
  expect(model1.origin.kind).toBe(OriginKind.Cowork);
  metaStore.set(wire.id, model1.origin, model1.binding);

  // 2. Second load -- read from store
  const meta = metaStore.get(wire.id);
  const model2 = mapper.fromWire(wire, {
    origin: JSON.parse(meta!.origin),
    binding: JSON.parse(meta!.binding),
  });
  expect(model2.origin).toEqual(model1.origin);
  expect(model2.binding).toEqual(model1.binding);
});

test('integration: wire roundtrip preserves all fields', () => {
  const model = makeModel({
    name: 'Roundtrip',
    description: 'Desc with "quotes" & special chars',
    schedule: { kind: ScheduleKind.Cron, expr: '*/5 * * * *' },
    payload: { kind: PayloadKind.AgentTurn, message: 'Do work', timeoutSeconds: 120 },
    origin: { kind: OriginKind.Manual },
    binding: { kind: BindingKind.NewSession },
  });
  const policy = taskPolicyRegistry.get(model.origin);
  const wire = mapper.toWireInput(model, policy);

  // Simulate fromWire (add back id/state/timestamps that toWireInput strips)
  const restored = mapper.fromWire(
    { ...wire, id: 'id-1', state: {}, createdAt: '', updatedAt: '' } as any,
    { origin: model.origin, binding: model.binding },
  );

  expect(restored.name).toBe('Roundtrip');
  expect(restored.description).toBe('Desc with "quotes" & special chars');
  expect(restored.schedule).toEqual({ kind: ScheduleKind.Cron, expr: '*/5 * * * *' });
  expect((restored.payload as any).message).toBe('Do work');
  expect((restored.payload as any).timeoutSeconds).toBe(120);
});
