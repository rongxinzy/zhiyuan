import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createModels, createProvider } from '@earendil-works/pi-ai/models';
import type { ClassifierResult, ProviderClassifier } from '@earendil-works/pi-ai';
import {
  classifyTierForTriage,
  classifyTierWithPi,
  setTriageClassifierDeps,
  type PiClassifierDeps,
} from './piClassifierTriage';

const classify = vi.fn<ProviderClassifier['classify']>();
const makeModels = vi.fn(createModels);
const deps: PiClassifierDeps = {
  createModels: makeModels,
  createProvider,
  llamaCppClassifyApi: () => ({ classify }),
};
const options = { baseUrl: 'http://127.0.0.1:8000', modelName: 'local-triage' };
const result = (choice = 'heavy', confidence = 0.82): ClassifierResult => ({
  api: 'llama-cpp-classify',
  provider: 'zhiyuan-triage',
  model: 'local-triage',
  timestamp: 1,
  stopReason: 'stop',
  answers: {
    tier: { type: 'choice', choice, confidence, probabilities: { [choice]: confidence } },
  },
});

beforeEach(() => {
  classify.mockReset();
  makeModels.mockClear();
  setTriageClassifierDeps(deps);
});
afterEach(() => setTriageClassifierDeps(null));

describe('native message triage classifier', () => {
  it('dispatches through real native Models/createProvider using a keyless local classifier model', async () => {
    classify.mockResolvedValueOnce(result());
    expect(await classifyTierWithPi('refactor\nthe parser', options)).toEqual({
      tier: 'heavy',
      confidence: 0.82,
    });
    expect(classify).toHaveBeenCalledOnce();
    expect(classify.mock.calls[0]?.[0]).toMatchObject({
      type: 'classifier',
      api: 'llama-cpp-classify',
      baseUrl: 'http://127.0.0.1:8000/v1',
      id: 'local-triage',
    });
    expect(classify.mock.calls[0]?.[1]).toMatchObject({
      state: { message: 'refactor the parser' },
      questions: { tier: { type: 'choice' } },
    });
    expect(classify.mock.calls[0]?.[2]).toMatchObject({ temperature: 1 });
    expect(classify.mock.calls[0]?.[2]?.apiKey).toBeUndefined();
  });

  it('reuses a native runtime for the same normalized server and model', async () => {
    classify.mockResolvedValue(result());
    await classifyTierWithPi('first', options);
    await classifyTierWithPi('second', { ...options, baseUrl: `${options.baseUrl}/v1/` });
    expect(makeModels).toHaveBeenCalledOnce();
    expect(classify).toHaveBeenCalledTimes(2);
    await classifyTierWithPi('other', { ...options, modelName: 'other-model' });
    expect(makeModels).toHaveBeenCalledTimes(2);
  });

  it('falls back for low confidence, invalid tiers, malformed confidence and error results', async () => {
    for (const answer of [
      result('light', 0.4),
      result('unrecognized'),
      result('heavy', Number.NaN),
      result('heavy', 2),
      { ...result(), stopReason: 'error' as const, errorMessage: 'unavailable' },
    ]) {
      classify.mockResolvedValueOnce(answer);
      expect(await classifyTierWithPi('hi', options)).toBeNull();
    }
    classify.mockRejectedValueOnce(new Error('network failure'));
    expect(await classifyTierWithPi('hi', options)).toBeNull();
  });

  it('respects confidence override and bounds the classification input', async () => {
    classify.mockResolvedValue(result('light', 0.4));
    expect(await classifyTierWithPi('x'.repeat(1000), { ...options, minConfidence: 0.3 })).toEqual({
      tier: 'light',
      confidence: 0.4,
    });
    expect(classify.mock.calls[0]?.[1].state.message).toHaveLength(400);
  });

  it('disables classification without startup deps or complete endpoint options', async () => {
    setTriageClassifierDeps(null);
    expect(await classifyTierForTriage('hi', options.baseUrl, options.modelName)).toBeNull();
    expect(await classifyTierWithPi('hi', options)).toBeNull();
    setTriageClassifierDeps(deps);
    expect(await classifyTierWithPi('hi', { ...options, baseUrl: '' })).toBeNull();
    expect(await classifyTierWithPi('hi', { ...options, modelName: '' })).toBeNull();
    expect(classify).not.toHaveBeenCalled();
  });
});
