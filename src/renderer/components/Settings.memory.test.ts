import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('./settings/SettingsPage.tsx', import.meta.url)),
  'utf8',
);

test('removes the cross-work memory page and embedding configuration writes', () => {
  expect(source).not.toContain("case 'coworkMemory':");
  expect(source).not.toContain('ManagedMemorySettings');
  expect(source).not.toContain('embeddingRemoteApiKey');
  expect(source).not.toContain('coworkService.updateConfig');
});
