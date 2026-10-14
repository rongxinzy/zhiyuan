import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { expect, test } from 'vitest';

interface Step {
  name?: string;
  id?: string;
  uses?: string;
  run?: string;
  if?: string;
  'continue-on-error'?: boolean;
  with?: Record<string, unknown>;
}

interface Workflow {
  on: Record<string, unknown>;
  jobs: Record<string, { steps: Step[] }>;
}

function workflow(file: string): Workflow {
  return load(
    readFileSync(new URL(`../../../.github/workflows/${file}`, import.meta.url), 'utf8'),
  ) as Workflow;
}

const windows = workflow('windows-installer-pr.yml');
const steps = windows.jobs['package-and-install'].steps;

test('Windows packaging retains required installation and size checks', () => {
  expect(windows.on).toHaveProperty('schedule');
  expect(windows.on).toHaveProperty('workflow_dispatch');
  expect(windows.on).toHaveProperty('workflow_call');
  for (const script of [
    'windows-installer-size-smoke.ps1',
    'windows-runtime-smoke.ps1',
    'windows-installer-smoke.ps1',
  ]) {
    const gate = steps.find(step => step.run?.includes(script));
    expect(gate).toBeDefined();
    expect(gate?.if).toBeUndefined();
    expect(gate?.['continue-on-error']).toBeUndefined();
  }
});

test('PRs restore without saving; verified main runs publish the same cache graph', () => {
  expect(steps.some(step => step.uses === 'actions/cache@v5')).toBe(false);
  const restore = steps.find(step => step.uses === 'actions/cache/restore@v5');
  const saveIndex = steps.findIndex(step => step.uses === 'actions/cache/save@v5');
  const save = steps[saveIndex];
  expect(restore?.id).toBe('packaging-cache');
  expect(save.if).toBe(
    "${{ github.ref == 'refs/heads/main' && github.event_name != 'pull_request' && steps.packaging-cache.outputs.cache-hit != 'true' }}",
  );
  expect(save.with?.path).toBe(restore?.with?.path);
  expect(save.with?.key).toBe('${{ steps.packaging-cache.outputs.cache-primary-key }}');
  expect(saveIndex).toBeGreaterThan(
    steps.findIndex(step => step.run?.includes('windows-installer-smoke.ps1')),
  );
  const install = steps.find(step => step.run === 'bun install --frozen-lockfile --ignore-scripts');
  expect(install).toBeDefined();
  expect(install?.if).toBeUndefined();
});
