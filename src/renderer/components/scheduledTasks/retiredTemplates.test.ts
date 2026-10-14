import { existsSync, readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

test('custom plans remain available without retired skill template launchers', () => {
  expect(existsSync(new URL('./TaskTemplateGallery.tsx', import.meta.url))).toBe(false);
  const view = readFileSync(new URL('./ScheduledTasksView.tsx', import.meta.url), 'utf8');
  const list = readFileSync(new URL('./TaskList.tsx', import.meta.url), 'utf8');
  expect(view).toContain('openCreateModal()');
  expect(view).toContain('<TaskForm');
  expect(view).not.toContain('onSelectTemplate');
  expect(list).not.toContain('TASK_TEMPLATES');
});
