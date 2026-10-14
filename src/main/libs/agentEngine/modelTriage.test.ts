import { describe, expect, it } from 'vitest';

import type { TriageConfig, TriageResult, TriageState } from '../../../shared/triage';
import { chooseTriageModelSwitch, classifyMessage, classifyByRules } from './modelTriage';
const config = (overrides: Partial<TriageConfig['rules']> = {}): TriageConfig => ({
  enabled: true,
  rules: {
    lightModelRef: 'llamacpp/qwen-small',
    heavyModelRef: 'zhipu/glm-5.2',
    maxConversationRoundsForTriage: 20,
    allowCrossProviderSwitch: false,
    cooldownRounds: 3,
    ...overrides,
  },
});

const state = (overrides: Partial<TriageState> = {}): TriageState => ({
  lastSwitchRound: 0,
  activeTier: 'standard',
  ...overrides,
});

describe('deterministic triage', () => {
  it('keeps ambiguous input on the rule result without an external endpoint', async () => {
    expect(await classifyMessage('Please help me with this', 1, config())).toEqual(
      classifyByRules('Please help me with this', 1, config()),
    );
  });
});

describe('chooseTriageModelSwitch', () => {
  const heavy: TriageResult = { tier: 'heavy', modelRef: 'zhipu/glm-5.2', reason: 'llm' };
  const light: TriageResult = { tier: 'light', modelRef: 'llamacpp/qwen-small', reason: 'llm' };

  it('switches models within the same provider and records the round', () => {
    const decision = chooseTriageModelSwitch('zhipu/glm-5.2-air', heavy, state(), config(), 7);
    expect(decision.modelRef).toBe('zhipu/glm-5.2');
    expect(decision.state).toEqual({ lastSwitchRound: 7, activeTier: 'heavy' });
  });

  it('blocks cross-provider switches unless explicitly allowed', () => {
    expect(chooseTriageModelSwitch('openai/gpt-5.2', heavy, state(), config(), 7).modelRef).toBe(
      null,
    );
    const allowCross = config({ allowCrossProviderSwitch: true });
    expect(chooseTriageModelSwitch('openai/gpt-5.2', heavy, state(), allowCross, 7).modelRef).toBe(
      'zhipu/glm-5.2',
    );
  });

  it('respects the cooldown when switching down', () => {
    const cooled = state({ activeTier: 'heavy', lastSwitchRound: 6 });
    // round 7 within cooldown of 3 → downgrade refused
    expect(chooseTriageModelSwitch('zhipu/glm-5.2', light, cooled, config(), 7).modelRef).toBe(
      null,
    );
    // round 10 clears it
    expect(chooseTriageModelSwitch('zhipu/glm-5.2', light, cooled, config(), 10).modelRef).toBe(
      null,
    );
    // light model lives on another provider, so even past cooldown it stays
    const sameProviderLight: TriageResult = {
      tier: 'light',
      modelRef: 'zhipu/glm-air',
      reason: 'llm',
    };
    expect(
      chooseTriageModelSwitch('zhipu/glm-5.2', sameProviderLight, cooled, config(), 10).modelRef,
    ).toBe('zhipu/glm-air');
  });

  it('keeps the current model when the result matches or carries no ref', () => {
    expect(chooseTriageModelSwitch('zhipu/glm-5.2', heavy, state(), config(), 1).modelRef).toBe(
      null,
    );
    const noRef: TriageResult = { tier: 'standard', modelRef: null, reason: 'default' };
    expect(chooseTriageModelSwitch('openai/gpt-5.2', noRef, state(), config(), 1).modelRef).toBe(
      null,
    );
  });
});
