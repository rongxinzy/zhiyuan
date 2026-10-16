import { expect, test } from 'vitest';

import { createBrowserPreviewElectronMock } from './createBrowserPreviewElectronMock';

test('browser preview mock exposes store, catalog, and activity stubs', async () => {
  const electron = createBrowserPreviewElectronMock();
  const config = await electron.store.get('app_config');
  expect(config).toBeTruthy();
  const catalog = await electron.magpie.catalog();
  expect(catalog.models.length).toBeGreaterThan(0);
  const activity = await electron.activity.list();
  expect(activity.success).toBe(true);
});
