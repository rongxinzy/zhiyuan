import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('./CoworkView.tsx', import.meta.url)), 'utf8');

test('does not load or forward retired capabilities in start, continuation or recovery', () => {
  for (const removed of [
    'activeSkillIds',
    'sessionSkillIds',
    'skillIds:',
    'quickActionService',
    'shouldAutoAllowChatSkill',
  ]) {
    expect(source).not.toContain(removed);
  }
  expect(source).toContain('coworkService.startSession(');
  expect(source).toContain('coworkService.continueSession(');
  expect(source).toContain('taskResume.resume(');
  expect(source).toContain('permissionMode: config.permissionMode');
  expect(source).toContain('permissionMode: sessionPermissionMode');
});
