import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('./CodingWorkbenchView.tsx', import.meta.url)),
  'utf8',
);

test('keeps the manager dialog with its sidebar event hook and removes the toolbar entry', () => {
  expect(source).toContain('useCodingAgentManager()');
  expect(source).toContain('<CodingAgentManager');
  expect(source).not.toContain('<Settings2 />');
});

test('renders the manager before a workspace or snapshot is available', () => {
  const managerElementIndex = source.indexOf('const agentManagerElement');
  expect(managerElementIndex).toBeGreaterThan(-1);
  expect(managerElementIndex).toBeLessThan(source.indexOf('if (!workspaceRoot)'));
  // Empty, loading/error and loaded states all render the dialog.
  expect(source.match(/\{agentManagerElement\}/g) ?? []).toHaveLength(3);
  // Profiles load independently of the room snapshot.
  expect(source).toContain('codingAgent.listProfiles()');
});

test('floats the approval card over the composer slot like work mode', () => {
  const composerIndex = source.indexOf('<CodingComposer');
  const overlayIndex = source.indexOf('<CodingPermissionOverlay');
  expect(composerIndex).toBeGreaterThan(-1);
  expect(overlayIndex).toBeGreaterThan(composerIndex);
  expect(source).toContain('permission={activePermission}');
});

test('prioritizes project and task context while keeping composer and management separate', () => {
  expect(source).toMatch(/title=\{\s*snapshot\.room\.name\s*\|\|/);
  expect(source.indexOf('<CodingTaskOverview')).toBeLessThan(source.indexOf('<CodingEventStream'));
  expect(source.indexOf('<CodingEventStream')).toBeLessThan(source.indexOf('<CodingComposer'));
  expect(source).toContain('projectedTurns={activeTurns}');
  expect(source).toContain(
    'hasOutput={activeEvents.some(event => event.kind === CodingEventKind.Terminal)}',
  );
  expect(source).not.toContain('headerActions={');
  expect(source).not.toContain('magpie.start(');
  expect(source).not.toContain('magpie.agents(');
  expect(source).toContain('saveDraft(activeLane.id, next)');
});
