// @vitest-environment jsdom
import { createElement } from 'react';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { AppearanceSettingsPanel } from './AppearanceSettingsPanel';
vi.mock('../../../services/i18n', () => ({ i18nService: { t: (key: string) => key } }));
afterEach(cleanup);
test('offers only light, dark and system appearance with no theme package management', () => {
  const change = vi.fn();
  const view = render(
    createElement(AppearanceSettingsPanel, { appearance: 'system', onAppearanceChange: change }),
  );
  expect(view.getAllByRole('tab')).toHaveLength(3);
  fireEvent.click(view.getByRole('tab', { name: 'dark' }));
  expect(change).toHaveBeenCalledWith('dark');
  expect(view.container.querySelector('[data-theme-preview]')).toBeNull();
  expect(view.queryByText('themeStyle')).toBeNull();
});
