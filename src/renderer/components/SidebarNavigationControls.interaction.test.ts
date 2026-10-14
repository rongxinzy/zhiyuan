// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { SidebarNavigationControls } from './SidebarNavigationControls';
import { WorkMode } from '../store/workMode/constants';

const mocks = vi.hoisted(() => ({
  state: {
    activity: { runs: [] as { status: string }[] },
    skill: { activeSkillIds: [] as string[] },
  },
  clearWorkspaceSelection: vi.fn(async () => {}),
}));
vi.mock('react-redux', () => ({
  useSelector: (selector: (state: unknown) => unknown) => selector(mocks.state),
}));
vi.mock('../services/workspace', () => ({
  workspaceService: { clearWorkspaceSelection: mocks.clearWorkspaceSelection },
}));
vi.mock('../services/i18n', () => ({ i18nService: { t: (key: string) => key } }));
beforeEach(() => {
  mocks.state = { activity: { runs: [] }, skill: { activeSkillIds: [] } };
});
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
  onShowExpert: vi.fn(),
  onShowCoding: vi.fn(),
  onShowTodo: vi.fn(),
  onShowLocalInference: vi.fn(),
  onShowScheduledTasks: vi.fn(),
  onShowActivity: vi.fn(),
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

test('preserves new-task workspace cleanup and view navigation callbacks', async () => {
  const user = userEvent.setup();
  const handlers = props();
  render(createElement(SidebarNavigationControls, { ...handlers, activeView: 'todo' }));
  await user.click(screen.getByTestId('sidebar-new-conversation'));
  expect(mocks.clearWorkspaceSelection).toHaveBeenCalledTimes(1);
  expect(handlers.onNewChat).toHaveBeenCalledTimes(1);
  expect(mocks.clearWorkspaceSelection.mock.invocationCallOrder[0]).toBeLessThan(
    handlers.onNewChat.mock.invocationCallOrder[0],
  );
  const views = [
    ['codingAgent', handlers.onShowCoding, undefined],
    ['todoTitle', handlers.onShowTodo, 'todo'],
    ['scheduledTasks', handlers.onShowScheduledTasks, 'scheduledTasks'],
    ['activityTitle', handlers.onShowActivity, 'activity'],
    ['expert', handlers.onShowExpert, 'expert'],
  ] as const;
  const localInference = screen.getByRole('button', { name: 'localInferenceTitle' });
  await user.click(localInference);
  expect(handlers.onShowLocalInference).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('button', { name: 'todoTitle' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'expert' })).toBeNull();
  expect(screen.getByTestId('sidebar-work-tools')).toHaveAttribute('data-active', 'true');
  for (const [label, callback, prefetch] of views) {
    await user.click(screen.getByTestId('sidebar-work-tools'));
    const button = await screen.findByRole('menuitem', { name: label });
    if (label === 'todoTitle') expect(button).toHaveAttribute('aria-current', 'page');
    handlers.onPrefetchView.mockClear();
    await user.hover(button);
    if (prefetch) expect(handlers.onPrefetchView).toHaveBeenCalledWith(prefetch);
    // Menu hover moves focus as well; leave the item before testing focus intent separately.
    button.blur();
    handlers.onPrefetchView.mockClear();
    button.focus();
    if (prefetch) expect(handlers.onPrefetchView).toHaveBeenCalledWith(prefetch);
    await user.keyboard('{Enter}');
    expect(callback).toHaveBeenCalledTimes(1);
  }
  expect(screen.getByTestId('sidebar-new-conversation')).not.toHaveAttribute('aria-current');
});

test('keeps managed-only and chat navigation policies and chat workspace selection', async () => {
  const user = userEvent.setup();
  const handlers = props();
  const view = render(
    createElement(SidebarNavigationControls, { ...handlers, managedModelsOnly: true }),
  );
  expect(screen.queryByRole('button', { name: 'localInferenceTitle' })).toBeNull();
  expect(screen.getByTestId('sidebar-work-tools')).toBeTruthy();
  view.rerender(createElement(SidebarNavigationControls, { ...handlers, workMode: WorkMode.Chat }));
  expect(screen.getAllByRole('button')).toHaveLength(1);
  await user.click(screen.getByRole('button', { name: 'newChat' }));
  expect(handlers.onNewChat).toHaveBeenCalledTimes(1);
  expect(mocks.clearWorkspaceSelection).not.toHaveBeenCalled();
  await user.click(screen.getByRole('switch', { name: 'workMode / chatMode' }));
  await flushModeChangeFrame();
  expect(handlers.onWorkModeChange.mock.calls[0][0]).toBe(false);
});

test('preserves activity status and highlights the current conversation route', async () => {
  const user = userEvent.setup();
  mocks.state = {
    activity: { runs: [{ status: 'running' }] },
    skill: { activeSkillIds: ['skill-1'] },
  };
  const handlers = props();
  const view = render(createElement(SidebarNavigationControls, handlers));
  expect(screen.getByTestId('sidebar-work-tools')).toHaveAccessibleName(
    'sidebarWorkTools activityStatusRunning',
  );
  await user.click(screen.getByTestId('sidebar-work-tools'));
  expect(await screen.findByTestId('sidebar-view-activity')).toHaveTextContent(
    'activityStatusRunning',
  );
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.getByTestId('sidebar-work-tools')).toHaveFocus());
  view.rerender(createElement(SidebarNavigationControls, { ...handlers, workMode: WorkMode.Chat }));
  expect(screen.getByTestId('sidebar-new-conversation')).toHaveAttribute('data-active');
  mocks.state = { activity: { runs: [] }, skill: { activeSkillIds: [] } };
  view.rerender(createElement(SidebarNavigationControls, { ...handlers, workMode: WorkMode.Chat }));
  expect(screen.getByTestId('sidebar-new-conversation')).toHaveAttribute('data-active', 'true');
});
