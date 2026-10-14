import { expect, test } from 'vitest';
import { CodingAgentRegistry } from './codingAgentRegistry';
import { CodingAgentProfileId } from '../../shared/codingAgent';
import { readFileSync, existsSync } from 'node:fs';
test('builtin profile advertises no plan or free-text question producer', () => {
  const profile = new CodingAgentRegistry().get(CodingAgentProfileId.Builtin)!;
  expect(profile.capabilities.supportsPlans).toBe(false);
  expect(profile.capabilities.supportsElicitation).toBe(false);
  const configuration = readFileSync('src/main/libs/agentEngine/durable/configuration.ts', 'utf8');
  expect(configuration).not.toMatch(/plan_write|codingElicitation|createPiPlanTool/);
  expect(existsSync('src/main/libs/agentEngine/piPlanTool.ts')).toBe(false);
  expect(existsSync('src/main/libs/agentEngine/piCapabilityCorrection.ts')).toBe(false);
});
