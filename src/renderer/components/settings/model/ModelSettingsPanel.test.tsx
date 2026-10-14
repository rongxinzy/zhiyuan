// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import ModelSettingsPanel from './ModelSettingsPanel';
import { store } from '../../../store';

vi.mock('../../../services/i18n', () => ({ i18nService: { t: (key: string) => key } }));
const api = {
  catalog: vi.fn(),
  status: vi.fn(),
  start: vi.fn(),
  selectDefault: vi.fn(),
  openManagement: vi.fn(),
};
const stopped = { status: { state: 'stopped', version: '1' }, models: [], defaultModelId: null };
const running = {
  status: { state: 'running', version: '1' },
  models: [{ id: 'vendor/exact', display_name: 'Exact model', native_endpoints: ['anthropic'] }],
  defaultModelId: null,
};
beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, 'electron', { configurable: true, value: { magpie: api } });
  api.catalog.mockResolvedValue(stopped);
  api.status.mockResolvedValue(stopped.status);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
test('opening settings only reads catalog and requires informed explicit activation', async () => {
  render(<ModelSettingsPanel />);
  await waitFor(() => expect(api.catalog).toHaveBeenCalledTimes(1));
  expect(api.start).not.toHaveBeenCalled();
  expect(api.openManagement).not.toHaveBeenCalled();
  expect(screen.getByText('magpieCatalogConsent')).toBeTruthy();
  api.start.mockResolvedValue(running.status);
  api.catalog.mockResolvedValue(running);
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'magpieCatalogEnable' }).hasAttribute('disabled'),
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole('button', { name: 'magpieCatalogEnable' }));
  await screen.findByText('Exact model');
  expect(api.start).toHaveBeenCalledTimes(1);
  expect(store.getState().model.defaultSelectedModel.id).toBe('');
});
test('failed start remains stopped and does not load or claim a model', async () => {
  api.start.mockResolvedValue({ state: 'failed', version: '1' });
  render(<ModelSettingsPanel />);
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'magpieCatalogEnable' }).hasAttribute('disabled'),
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole('button', { name: 'magpieCatalogEnable' }));
  await screen.findByRole('alert');
  expect(screen.getByText('magpieState_failed')).toBeTruthy();
  expect(api.catalog).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('combobox')).toBeNull();
});

test('explicit enable displays starting immediately and failed immediately without polling', async () => {
  let finish!: (value: { state: string; version: string }) => void;
  api.start.mockImplementation(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  render(<ModelSettingsPanel />);
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'magpieCatalogEnable' }).hasAttribute('disabled'),
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole('button', { name: 'magpieCatalogEnable' }));
  expect(screen.getByText('magpieState_starting')).toBeTruthy();
  expect(screen.queryByText('magpieState_stopped')).toBeNull();
  await act(async () => finish({ state: 'failed', version: '1' }));
  expect(screen.getByText('magpieState_failed')).toBeTruthy();
  expect(api.status).not.toHaveBeenCalled();
  expect(api.catalog).toHaveBeenCalledTimes(1);
});
test('sends exact catalog id only after explicit default confirmation', async () => {
  api.catalog.mockResolvedValue(running);
  api.selectDefault.mockResolvedValue({ ...running, defaultModelId: 'vendor/exact' });
  render(<ModelSettingsPanel />);
  await screen.findByRole('combobox');
  await waitFor(() => expect(screen.getByRole('combobox').hasAttribute('disabled')).toBe(false));
  fireEvent.click(screen.getByRole('combobox'));
  fireEvent.click(await screen.findByRole('option', { name: 'Exact model' }));
  expect(api.selectDefault).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'magpieSetDefault' }));
  await waitFor(() => expect(api.selectDefault).toHaveBeenCalledWith('vendor/exact'));
  await waitFor(() => expect(store.getState().model.defaultSelectedModel.id).toBe('vendor/exact'));
});
test('rejected default save preserves the last confirmed state and surfaces error', async () => {
  api.catalog.mockResolvedValue(running);
  api.selectDefault.mockRejectedValue(new Error('rejected'));
  render(<ModelSettingsPanel />);
  await screen.findByRole('combobox');
  await waitFor(() => expect(screen.getByRole('combobox').hasAttribute('disabled')).toBe(false));
  fireEvent.click(screen.getByRole('combobox'));
  fireEvent.click(await screen.findByRole('option', { name: 'Exact model' }));
  fireEvent.click(screen.getByRole('button', { name: 'magpieSetDefault' }));
  await screen.findByRole('alert');
  expect(store.getState().model.defaultSelectedModel.id).toBe('');
});
test('process exit clears stale models without starting or reading management', async () => {
  vi.useFakeTimers();
  api.catalog.mockResolvedValue({ ...running, defaultModelId: 'vendor/exact' });
  render(<ModelSettingsPanel />);
  await act(async () => {
    await Promise.resolve();
  });
  expect(store.getState().model.defaultSelectedModel.id).toBe('vendor/exact');
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
  expect(screen.queryByRole('combobox')).toBeNull();
  expect(store.getState().model.availableModels).toEqual([]);
  expect(api.start).not.toHaveBeenCalled();
  expect(api.catalog).toHaveBeenCalledTimes(1);
});
