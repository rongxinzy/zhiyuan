import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const appSource = readFileSync(fileURLToPath(new URL('./App.tsx', import.meta.url)), 'utf8');

// App is not render-mounted in unit tests; these assertions pin the exclusive managed
// provider wiring so regressions in the effect guards are caught.
test('refreshes available models when the managed provider projection changes', () => {
  const handlerMatch = appSource.match(
    /const handleManagedProvidersChanged = \(\) => \{[\s\S]*?\};/,
  );
  expect(handlerMatch).not.toBeNull();
  expect(handlerMatch?.[0]).toContain('void refreshAvailableModels();');
  expect(appSource).toContain('window.electron.managedProviders.onChanged(');
  expect(appSource).toContain('unsubscribeManagedProviders();');
});

test('all modes use the Magpie catalog without legacy default persistence or startup', () => {
  expect(appSource).toContain('refreshMagpieModels()');
  expect(appSource).not.toContain('config.model');
  expect(appSource).not.toContain('config.providers');
  expect(appSource).not.toContain('setDefaultSelectedModel');
  expect(appSource).not.toContain('magpie.start(');
  expect(appSource).not.toContain('onTokenUpdated');
  expect(appSource).toContain("window.addEventListener('focus', handleConfigUpdated)");
  expect(appSource).toContain("window.removeEventListener('focus', handleConfigUpdated)");
});

test('catalog failure does not prevent shell initialization', () => {
  expect(appSource).toMatch(/waitWithTimeout\(refreshMagpieModels\(\),[\s\S]*?\.catch\(error =>/);
  expect(appSource).toContain('setIsInitialized(true)');
});
