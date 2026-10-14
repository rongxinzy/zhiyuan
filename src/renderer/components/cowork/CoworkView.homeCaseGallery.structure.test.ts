import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('./CoworkView.tsx', import.meta.url)), 'utf8');

test('keeps Work briefing and the shared composer without the legacy case gallery', () => {
  expect(source).toContain('<WorkBriefingHome');
  expect(source).toContain('prompt={homePrompt}');
  expect(source).toContain('onFocusInput={() => promptInputRef.current?.focus()}');
  expect(source).toContain('{homePrompt}');
  for (const removed of [
    'QuickActionBar',
    'PromptPanel',
    'quickActionService',
    'homeQuickActions',
  ]) {
    expect(source).not.toContain(removed);
  }
});
