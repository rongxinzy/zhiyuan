import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('./agent.ts', import.meta.url)), 'utf8');

test('switches profiles without restoring removed capability selection', () => {
  const start = source.indexOf('switchAgent(agentId: string): void');
  const switchAgent = source.slice(start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(switchAgent).toContain('dispatch(setCurrentAgentId(agentId))');
  expect(switchAgent).toContain('dispatch(clearCurrentSession())');
  expect(switchAgent).not.toContain('skill');
});

test('does not reintroduce capability state when editing a profile', () => {
  const start = source.indexOf('async updateAgent(');
  const end = source.indexOf('\n  async deleteAgent', start);
  const updateAgent = source.slice(start, end);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  expect(updateAgent).not.toContain('setActiveSkillIds');
});
