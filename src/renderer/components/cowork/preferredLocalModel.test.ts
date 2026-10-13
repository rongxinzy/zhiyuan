import { expect, test } from 'vitest';

import { assessLlamaCppAgentEligibility } from '../../../shared/llamacpp';
import { ProviderName } from '../../../shared/providers';
import type { Model } from '../../store/slices/modelSlice';
import { getPreferredReadyLocalModel } from './preferredLocalModel';

const local = (id: string, context = 32768): Model => ({
  id,
  name: id,
  providerKey: ProviderName.LlamaCpp,
  llamaCppAgentEligibility: assessLlamaCppAgentEligibility({ runtimeContextWindow: context }),
});

test('only selects a ready local model and never falls back to a cloud provider', () => {
  const cloud = { ...local('cloud'), providerKey: ProviderName.OpenAI };
  const notReady = local('small-context', 4096);
  const unknown = { ...local('unknown'), llamaCppAgentEligibility: undefined };
  expect(getPreferredReadyLocalModel([cloud, notReady, unknown], cloud)).toBeNull();
  expect(getPreferredReadyLocalModel([], null)).toBeNull();
  const ready = local('ready');
  expect(getPreferredReadyLocalModel([cloud, notReady, ready], cloud)).toBe(ready);
});

test('preserves the current ready local selection and ignores vanished models', () => {
  const first = local('first');
  const selected = local('selected');
  expect(getPreferredReadyLocalModel([first, selected], selected)).toBe(selected);
  expect(getPreferredReadyLocalModel([first], selected)).toBe(first);
});
