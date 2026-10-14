import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('./PromptPlusMenu.tsx', import.meta.url)),
  'utf8',
);

test('keeps attachments and session experts without an unsupported goal mode', () => {
  expect(source).toContain('onAddFile();');
  expect(source).not.toContain('onGoalModeChange');
  expect(source).not.toContain('goalMode');
  expect(source).toContain('const availableExperts = useMemo(');
  expect(source).toContain('handleToggleExpert(expert.id)');
});

test('removes legacy capability menus and all connector loading side effects', () => {
  for (const removed of [
    'skillService',
    'mcpService',
    'state.skill',
    'state.mcp',
    'onManageSkills',
    'onManageConnectors',
    'handleToggleServer',
  ]) {
    expect(source).not.toContain(removed);
  }
});
