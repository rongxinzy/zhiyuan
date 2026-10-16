// @vitest-environment jsdom
import { expect, test } from 'vitest';

import { BrowserPreviewFixtureId } from './browserPreviewFixtures';
import { createBrowserPreviewElectronMock } from './createBrowserPreviewElectronMock';

test('browser preview mock exposes rich fixtures for main views', async () => {
  localStorage.setItem(
    'app_config',
    JSON.stringify({ theme: 'dark', language: 'zh', workMode: 'work' }),
  );
  const electron = createBrowserPreviewElectronMock();
  const config = await electron.store.get('app_config');
  expect(config).toMatchObject({ theme: 'dark', language: 'zh' });

  const catalog = await electron.magpie.catalog();
  expect(catalog.status.state).toBe('running');
  expect(catalog.models.length).toBeGreaterThan(1);

  const workspaces = await electron.cowork.listWorkspaces();
  expect(workspaces.workspaces?.length).toBeGreaterThan(1);

  const sessions = await electron.cowork.listSessions({
    workspaceId: BrowserPreviewFixtureId.WorkspaceMain,
  });
  expect(sessions.sessions?.length).toBeGreaterThan(0);

  const session = await electron.cowork.getSession(BrowserPreviewFixtureId.SessionRoadmap);
  expect(session.success).toBe(true);
  expect(session.session?.messages.length).toBeGreaterThan(2);

  const activity = await electron.activity.list();
  expect(activity.runs?.length).toBeGreaterThan(0);

  const tasks = await electron.scheduledTasks.list();
  expect(tasks.tasks?.length).toBeGreaterThan(0);

  const localModels = await electron.llamacpp.listLocalModels();
  expect(localModels.length).toBeGreaterThan(0);

  const llamaStatus = await electron.llamacpp.status();
  expect(llamaStatus.status).toBe('running');

  const durable = await electron.cowork.getDurableWork(BrowserPreviewFixtureId.SessionRoadmap);
  expect(durable.success).toBe(true);
  expect(durable.snapshot?.pendingSubmissionCount).toBeGreaterThan(0);

  const workDocument = await electron.cowork.getWorkDocument(
    BrowserPreviewFixtureId.SessionRoadmap,
  );
  expect(workDocument.success).toBe(true);
  expect(workDocument.data?.goal).toContain('Phase 1');
});
