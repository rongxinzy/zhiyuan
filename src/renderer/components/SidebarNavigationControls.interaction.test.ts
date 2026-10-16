// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, expect, test, vi } from 'vitest';

import { SidebarNavigationControls } from './SidebarNavigationControls';
import { WorkMode } from '../store/workMode/constants';

const mocks = vi.hoisted(() => ({
  clearWorkspaceSelection: vi.fn(async () => {}),
}));
vi.mock('../services/workspace', () => ({
  workspaceService: { clearWorkspaceSelection: mocks.clearWorkspaceSelection },
}));
vi.mock('../services/i18n', () => ({ i18nService: { t: (key: string) => key } }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// The mode switch defers onModeChange by one animation frame (optimistic
// thumb transition); assertions must flush that frame first.
const flushModeChangeFrame = () =>
  new Promise<void>(resolve => {
    requestAnimationFrame(() => resolve());
  });

const props = () => ({
  activeView: 'cowork' as const,
  workMode: WorkMode.Work,
  onNewChat: vi.fn(),
  onShowLocalInference: vi.fn(),
  onWorkModeChange: vi.fn(),
  onPrefetchView: vi.fn(),
});

test('changes work mode exactly once per click or keyboard activation', async () => {
  const user = userEvent.setup();
  const handlers = props();
  render(createElement(SidebarNavigationControls, handlers));
  const toggle = screen.getByRole('switch');
  await user.click(toggle);
  await flushModeChangeFrame();
  expect(handlers.onWorkModeChange).toHaveBeenCalledTimes(1);
  expect(handlers.onWorkModeChange.mock.calls[0][0]).toBe(true);
  handlers.onWorkModeChange.mockClear();
  toggle.focus();
  await user.keyboard(' ');
  await flushModeChangeFrame();
  expect(handlers.onWorkModeChange).toHaveBeenCalledTimes(1);
});

test('keeps slim primary navigation and local inference routing', async () => {
  const user = userEvent.setup();
  const handlers = props();
  render(createElement(SidebarNavigationControls, { ...handlers, activeView: 'todo' }));
  expect(screen.getByText('sidebarSessionsAndWork')).toBeTruthy();
  expect(screen.queryByTestId('sidebar-work-tools')).toBeNull();
  expect(screen.queryByRole('button', { name: 'todoTitle' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'expert' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'historyTitle' })).toBeNull();
  expect(screen.getByTestId('sidebar-new-conversation')).toHaveAttribute('data-active', 'true');

  await user.click(screen.getByTestId('sidebar-new-conversation'));
  expect(mocks.clearWorkspaceSelection).toHaveBeenCalledTimes(1);
  expect(handlers.onNewChat).toHaveBeenCalledTimes(1);
  expect(mocks.clearWorkspaceSelection.mock.invocationCallOrder[0]).toBeLessThan(
    handlers.onNewChat.mock.invocationCallOrder[0],
  );

  handlers.onPrefetchView.mockClear();
  const localInference = screen.getByRole('button', { name: 'localInferenceTitle' });
  await user.hover(localInference);
  expect(handlers.onPrefetchView).toHaveBeenCalledWith('localInference');
  await user.click(localInference);
  expect(handlers.onShowLocalInference).toHaveBeenCalledTimes(1);
});

test('keeps managed-only and chat navigation policies and chat workspace selection', async () => {
  const user = userEvent.setup();
  const handlers = props();
  const view = render(
    createElement(SidebarNavigationControls, { ...handlers, managedModelsOnly: true }),
  );
  expect(screen.queryByRole('button', { name: 'localInferenceTitle' })).toBeNull();
  view.rerender(createElement(SidebarNavigationControls, { ...handlers, workMode: WorkMode.Chat }));
  expect(screen.queryByRole('button', { name: 'localInferenceTitle' })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'newChat' }));
  expect(handlers.onNewChat).toHaveBeenCalledTimes(1);
  expect(mocks.clearWorkspaceSelection).not.toHaveBeenCalled();
  await user.click(screen.getByRole('switch', { name: 'workMode / chatMode' }));
  await flushModeChangeFrame();
  expect(handlers.onWorkModeChange.mock.calls[0][0]).toBe(false);
});

test('highlights the current conversation route in chat mode', () => {
  const handlers = props();
  const view = render(createElement(SidebarNavigationControls, handlers));
  expect(screen.getByTestId('sidebar-new-conversation')).toHaveAttribute('data-active', 'true');
  view.rerender(createElement(SidebarNavigationControls, { ...handlers, workMode: WorkMode.Chat }));
  expect(screen.getByTestId('sidebar-new-conversation')).toHaveAttribute('data-active', 'true');
});
