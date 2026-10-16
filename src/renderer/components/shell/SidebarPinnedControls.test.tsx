// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, expect, test, vi } from 'vitest';

import { SidebarPinnedControls } from './SidebarPinnedControls';

vi.mock('../../services/i18n', () => ({ i18nService: { t: (key: string) => key } }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test('routes pinned footer entries and prefetches their views', async () => {
  const user = userEvent.setup();
  const onShowSkillsAndMcp = vi.fn();
  const onShowSettings = vi.fn();
  const onPrefetchView = vi.fn();
  render(
    createElement(SidebarPinnedControls, {
      activeView: 'settings',
      onShowSkillsAndMcp,
      onShowSettings,
      onPrefetchView,
    }),
  );

  expect(screen.getByTestId('sidebar-settings')).toHaveAttribute('aria-current', 'page');

  await user.hover(screen.getByTestId('sidebar-skills-and-mcp'));
  expect(onPrefetchView).toHaveBeenCalledWith('skillsMcp');
  onPrefetchView.mockClear();
  await user.click(screen.getByTestId('sidebar-skills-and-mcp'));
  expect(onShowSkillsAndMcp).toHaveBeenCalledTimes(1);

  onPrefetchView.mockClear();
  await user.hover(screen.getByTestId('sidebar-settings'));
  expect(onPrefetchView).toHaveBeenCalledWith('settings');
  await user.click(screen.getByTestId('sidebar-settings'));
  expect(onShowSettings).toHaveBeenCalledTimes(1);
});
