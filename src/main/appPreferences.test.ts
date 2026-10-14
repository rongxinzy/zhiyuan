import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  isManagedModelPreference,
  mergeAppPreferences,
  projectAppPreferences,
} from './appPreferences';
describe('ordinary app preferences boundary', () => {
  it('does not return retired secrets through normal settings IPC', () => {
    const result = projectAppPreferences({
      theme: 'dark',
      language: 'zh',
      providers: { secret: 'FAKE_OLD_KEY' },
      api: { apiKey: 'FAKE_KEY' },
      model: { defaultModel: 'old' },
      migrations: { secret: 'FAKE_KEY' },
      app: { port: 3000, isDevelopment: false, apiKey: 'FAKE_KEY' },
      shortcuts: { search: 'Ctrl+F', apiKey: 'FAKE_KEY' },
    });
    expect(result).toEqual({
      theme: 'dark',
      language: 'zh',
      app: { port: 3000, isDevelopment: false },
      shortcuts: { search: 'Ctrl+F' },
    });
    expect(JSON.stringify(result)).not.toContain('FAKE');
  });
  it('preserves existing disk keys without accepting renderer replacements', () => {
    const previous = { providers: { apiKey: 'OLD_FAKE' }, theme: 'light' };
    const merged = mergeAppPreferences(previous, {
      providers: { apiKey: 'NEW_FAKE' },
      theme: 'dark',
    });
    expect(merged).toEqual({ providers: previous.providers, theme: 'dark' });
    expect(projectAppPreferences(merged)).toEqual({ theme: 'dark' });
  });
  it('ignores malformed values and nested unknown fields', () => {
    expect(
      projectAppPreferences({
        theme: {},
        useSystemProxy: 'yes',
        app: { port: -1 },
        shortcuts: { search: {} },
      }),
    ).toEqual({ app: {}, shortcuts: {} });
  });
});

it('reserves model consent and validated selection for dedicated IPC', () => {
  expect(isManagedModelPreference('magpie_subscription_accounts_enabled')).toBe(true);
  expect(isManagedModelPreference('magpie_service_enabled')).toBe(true);
  expect(isManagedModelPreference('magpie_default_model_id')).toBe(true);
  expect(isManagedModelPreference('app_config')).toBe(false);
});

it('only restarts the model service after persistent explicit consent and keeps catalog reads passive', () => {
  const main = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
  const startup = main.slice(main.indexOf('const initApp = async'));
  expect(startup).toContain("if (getStore().get<boolean>('magpie_service_enabled') === true)");
  expect(startup.indexOf('await magpieManager?.ensureRunning()')).toBeGreaterThan(
    startup.indexOf('await initStore()'),
  );
  expect(startup.indexOf('await magpieManager?.ensureRunning()')).toBeLessThan(
    startup.indexOf('getCronJobService().startPolling()'),
  );
});
