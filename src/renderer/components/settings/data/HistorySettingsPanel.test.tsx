// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import type { HistoryApi } from '@shared/history';
import { HistorySettingsPanel } from './HistorySettingsPanel';
import { historyTranslations } from '../../../services/historyTranslations';
import { SETTINGS_NAV_GROUPS, SETTINGS_TAB_METAS } from '../constants';

vi.mock('../../../services/i18n', () => ({
  i18nService: {
    t: (key: string) => historyTranslations.zh[key as keyof typeof historyTranslations.zh] ?? key,
  },
}));

test('settings exposes explicit maintenance without starting it on entry', async () => {
  const api = {
    maintenanceStatus: vi.fn(async () => ({ success: true, data: null })),
    selectMaintenance: vi.fn(async () => ({ success: true, data: null })),
    confirmMaintenance: vi.fn(),
  } as unknown as HistoryApi;
  render(<HistorySettingsPanel api={api} />);
  await waitFor(() => expect(api.maintenanceStatus).toHaveBeenCalledOnce());
  expect(api.selectMaintenance).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '备份历史' }));
  await waitFor(() => expect(api.selectMaintenance).toHaveBeenCalledWith({ kind: 'backup' }));
  expect(api.confirmMaintenance).not.toHaveBeenCalled();
});

test('data has a settings destination and self-saving panels cannot submit general preferences', () => {
  expect(SETTINGS_NAV_GROUPS.flatMap(group => group.tabs)).toContain('data');
  expect(SETTINGS_TAB_METAS.data.labelKey).toBe('historySettingsLabel');
  const source = readFileSync('src/renderer/components/settings/SettingsPage.tsx', 'utf8');
  expect(source).toContain("case 'data':");
  expect(source).toContain('<HistorySettingsPanel api={window.electron.history}');
  expect(source).toContain("if (activeTab === 'data' || activeTab === 'model') return;");
  expect(source).toContain('flex-col sm:flex-row');
  expect(source).toContain('sm:w-[220px]');
});
