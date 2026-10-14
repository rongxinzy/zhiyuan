import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { generateDefaultAppearanceCSS } from './appearance-css';

test('checked-in CSS exactly matches the default light/dark appearances', () => {
  const checkedInCss = readFileSync(
    fileURLToPath(new URL('../css/themes.css', import.meta.url)),
    'utf8',
  ).replace(/\r\n?/g, '\n');
  expect(checkedInCss).toBe(generateDefaultAppearanceCSS());
});
