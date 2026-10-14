// @vitest-environment jsdom
import { createElement } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import type { HistoryApi } from '@shared/history';
import { HistoryMaintenanceControls } from './HistoryMaintenanceControls';
import { historyTranslations } from '../../services/historyTranslations';

vi.mock('../../services/i18n', () => ({
  i18nService: {
    t: (key: string) => historyTranslations.zh[key as keyof typeof historyTranslations.zh] ?? key,
  },
}));

type Api = Pick<HistoryApi, 'selectMaintenance' | 'confirmMaintenance' | 'maintenanceStatus'>;
function fixture(): Api {
  return {
    selectMaintenance: vi.fn<Api['selectMaintenance']>(async ({ kind }) => ({
      success: true,
      data: {
        selectionId: 'opaque-selection',
        displayPath: '/selected/history-backup',
        kind,
        requiresRestart: true,
        attachmentScope: 'managed-attachments-only',
        externalReferencesIncluded: false,
      },
    })),
    confirmMaintenance: vi.fn<Api['confirmMaintenance']>(async () => ({
      success: true,
      data: { scheduled: true },
    })),
    maintenanceStatus: vi.fn<Api['maintenanceStatus']>(async () => ({ success: true, data: null })),
  };
}

test('selection is read-only until explicit confirmation, which submits only an opaque id', async () => {
  const api = fixture();
  render(createElement(HistoryMaintenanceControls, { api }));
  fireEvent.click(screen.getByRole('button', { name: '恢复历史' }));
  await screen.findByRole('dialog');
  expect(screen.getByText('/selected/history-backup')).toBeTruthy();
  expect(screen.getByText(historyTranslations.zh.historyRestoreReplacementWarning)).toBeTruthy();
  expect(screen.getByText(historyTranslations.zh.historyBackupExclusions)).toBeTruthy();
  expect(api.confirmMaintenance).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '替换历史并重启' }));
  await screen.findByText(historyTranslations.zh.historyMaintenanceRestarting);
  expect(api.confirmMaintenance).toHaveBeenCalledExactlyOnceWith({
    selectionId: 'opaque-selection',
  });
  expect(screen.getByRole('button', { name: '替换历史并重启' })).toBeDisabled();
});

test('cancelling confirmation or native directory selection never schedules maintenance', async () => {
  const api = fixture();
  render(createElement(HistoryMaintenanceControls, { api }));
  fireEvent.click(screen.getByRole('button', { name: '备份历史' }));
  await screen.findByRole('dialog');
  fireEvent.click(screen.getByRole('button', { name: 'cancel' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  api.selectMaintenance = vi.fn<Api['selectMaintenance']>(async () => ({
    success: true,
    data: null,
  }));
  fireEvent.click(screen.getByRole('button', { name: '备份历史' }));
  await waitFor(() => expect(api.selectMaintenance).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(api.confirmMaintenance).not.toHaveBeenCalled();
});

test('repeated selection is disabled and failed validation is recoverable', async () => {
  const api = fixture();
  let resolve!: (value: Awaited<ReturnType<Api['selectMaintenance']>>) => void;
  api.selectMaintenance = vi.fn<Api['selectMaintenance']>(
    () =>
      new Promise(done => {
        resolve = done;
      }),
  );
  render(createElement(HistoryMaintenanceControls, { api }));
  fireEvent.click(screen.getByRole('button', { name: '恢复历史' }));
  fireEvent.click(screen.getByRole('button', { name: '恢复历史' }));
  expect(api.selectMaintenance).toHaveBeenCalledTimes(1);
  await act(async () => resolve({ success: false, error: 'raw private stack' }));
  expect(screen.getByText(historyTranslations.zh.historyMaintenanceSelectFailed)).toBeTruthy();
  expect(screen.queryByText('raw private stack')).toBeNull();
  expect(screen.getByRole('button', { name: '恢复历史' })).toBeEnabled();
});

test('uncertain scheduling is never automatically retried and can be dismissed', async () => {
  const api = fixture();
  api.confirmMaintenance = vi.fn(async () => {
    throw new Error('IPC disconnected');
  });
  render(createElement(HistoryMaintenanceControls, { api }));
  fireEvent.click(screen.getByRole('button', { name: '备份历史' }));
  await screen.findByRole('dialog');
  fireEvent.click(screen.getByRole('button', { name: '重启并备份' }));
  await screen.findByText(historyTranslations.zh.historyMaintenanceUncertain);
  expect(screen.getByRole('button', { name: '重启并备份' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'close' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(api.confirmMaintenance).toHaveBeenCalledTimes(1);
  expect(screen.getByText(historyTranslations.zh.historyMaintenanceUncertain)).toBeTruthy();
});

test('restart result reports verified rollback without exposing internal errors', async () => {
  const api = fixture();
  api.maintenanceStatus = vi.fn<Api['maintenanceStatus']>(async () => ({
    success: true,
    data: {
      kind: 'restore',
      status: 'recovered',
      rollbackPath: '/rollback',
      error: 'private stack',
    },
  }));
  render(createElement(HistoryMaintenanceControls, { api }));
  await screen.findByText(historyTranslations.zh.historyRestoreRecovered, { exact: false });
  expect(screen.getByText(/\/rollback/)).toBeTruthy();
  expect(screen.queryByText('private stack')).toBeNull();
});
