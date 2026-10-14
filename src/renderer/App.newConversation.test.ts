import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const appSource = readFileSync(fileURLToPath(new URL('./App.tsx', import.meta.url)), 'utf8');
const sidebarSource = readFileSync(
  fileURLToPath(new URL('./components/SidebarNavigationControls.tsx', import.meta.url)),
  'utf8',
);

const callbackBody = (source: string, name: string, nextName: string) => {
  const start = source.indexOf(`const ${name} = useCallback`);
  const end = source.indexOf(`const ${nextName} = useCallback`, start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
};

test('starts blank conversations without a removed capability registry', () => {
  const handleNewChat = callbackBody(
    appSource,
    'handleNewChat',
    'handleLocalInferenceInstallRequestHandled',
  );

  expect(handleNewChat).not.toContain('clearActiveSkills');
  expect(handleNewChat).toContain('openNewConversation({ clearExperts: true });');
  expect(sidebarSource).not.toContain('clearActiveSkills');
  expect(sidebarSource).not.toContain('workMode === WorkMode.Chat) dispatch');
});

test('new chat clears the prompt expert chip while expert-page entry does not', () => {
  const openNewConversation = callbackBody(appSource, 'openNewConversation', 'handleNewChat');
  const handleChatWithExpert = callbackBody(appSource, 'handleChatWithExpert', 'dismissToast');

  expect(openNewConversation).toContain('clearExperts: options?.clearExperts === true');
  expect(handleChatWithExpert).toContain('openNewConversation();');
  expect(handleChatWithExpert).not.toContain('clearExperts');
});

test('removes retired capability routes instead of leaving hidden launch callbacks', () => {
  expect(appSource).not.toContain('handleTrySkill');
  expect(appSource).not.toContain('handleTryMcp');
  expect(appSource).not.toContain("mainView === 'skills'");
  expect(appSource).not.toContain("mainView === 'mcp'");
});
