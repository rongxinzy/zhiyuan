import { defaultAppearances } from '../themes';
import { generateComponentCSS } from '../components/css';
import { validateComponentAppearances } from '../components/contract';
import type { ThemeDefinition } from '../themes/types';
import { TOKEN_CONTRACT, TOKEN_NAMES } from '../tokens/contract';

/** Build-time validation of the default light/dark token and recipe contract. */
function validateTheme(theme: ThemeDefinition): void {
  for (const token of TOKEN_NAMES) {
    const value = theme.tokens[token];
    if (typeof value !== 'string' || !value.trim() || /[;{}<>]|url\s*\(|@import/i.test(value))
      throw new Error(`Invalid token: ${token}`);
  }
  validateComponentAppearances(theme.components);
}

/** Generate a single [data-theme="id"] block */
export function generateAppearanceCSS(theme: ThemeDefinition): string {
  validateTheme(theme);
  const vars = TOKEN_NAMES.map(name => `  ${TOKEN_CONTRACT[name]}: ${theme.tokens[name]};`).join(
    '\n',
  );
  const colorScheme = theme.meta.appearance === 'dark' ? 'dark' : 'light';
  return `[data-theme="${theme.meta.id}"] {\n  color-scheme: ${colorScheme};\n${vars}\n}\n${generateComponentCSS(theme.components, `[data-theme="${theme.meta.id}"]`)}`;
}

/** Generate the full CSS for all themes.
 *  The first theme is merged with :root to avoid duplication. */
export function generateDefaultAppearanceCSS(): string {
  const themes = defaultAppearances;
  themes.forEach(validateTheme);
  if (themes.length === 0) return '';

  const defaultTheme = themes[0];
  const defaultVars = TOKEN_NAMES.map(
    name => `  ${TOKEN_CONTRACT[name]}: ${defaultTheme.tokens[name]};`,
  ).join('\n');
  const colorScheme = defaultTheme.meta.appearance === 'dark' ? 'dark' : 'light';
  const rootCSS = `:root, [data-theme="${defaultTheme.meta.id}"] {\n  color-scheme: ${colorScheme};\n${defaultVars}\n}\n${generateComponentCSS(defaultTheme.components, `:where(:root:not([data-theme]), [data-theme="${defaultTheme.meta.id}"])`)}`;

  const restCSS = themes.slice(1).map(generateAppearanceCSS).join('\n\n');
  return `/* Generated default light/dark appearances — do not edit manually */\n\n${rootCSS}\n\n${restCSS}\n`;
}
