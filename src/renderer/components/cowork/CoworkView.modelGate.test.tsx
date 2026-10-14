// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { ReactNode } from 'react';
import CoworkView from './CoworkView';
import coworkReducer, {
  setDraftPrompt,
  setCurrentSession,
  clearCurrentSession,
} from '../../store/slices/coworkSlice';
import { refreshMagpieModels } from '../../services/availableModels';
import { coworkService } from '../../services/cowork';
import { showAppErrorToast } from '../../services/toastNotification';
import type { CoworkSession } from '../../types/cowork';

let submit: (prompt: string) => Promise<boolean | void>;
vi.mock('./CoworkPromptInput', () => ({
  default: ({ onSubmit }: { onSubmit: typeof submit }) => {
    submit = onSubmit;
    return <div>composer</div>;
  },
}));
vi.mock('./CoworkSessionViewport', () => ({
  default: () => <div>existing work and document</div>,
}));
vi.mock('./briefing/WorkBriefingHome', () => ({
  WorkBriefingHome: ({ prompt }: { prompt: ReactNode }) => <main>{prompt}</main>,
}));
vi.mock('../PageHeader', () => ({ default: () => null }));
vi.mock('./SecurityStatusIndicator', () => ({ default: () => null }));
vi.mock('../LogoLoadingState', () => ({ LogoLoadingState: () => <div>loading</div> }));
vi.mock('./agentModelSelection', () => ({ useAgentSelectedModel: () => null }));
vi.mock('../../services/agent', () => ({
  agentService: { loadAgents: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('../../services/workspace', () => ({ workspaceService: {} }));
vi.mock('../../services/coworkQueue', () => ({ coworkQueueService: {} }));
vi.mock('../../services/availableModels', () => ({ refreshMagpieModels: vi.fn() }));
vi.mock('../../services/cowork', () => ({
  coworkService: {
    init: vi.fn().mockResolvedValue(undefined),
    loadSessions: vi.fn(),
    startSession: vi.fn(),
  },
}));
vi.mock('../../services/i18n', () => ({ i18nService: { t: (key: string) => key } }));
vi.mock('../../services/toastNotification', () => ({ showAppErrorToast: vi.fn() }));

const makeStore = () =>
  configureStore({
    reducer: {
      cowork: coworkReducer,
      agent: () => ({ currentAgentId: null, agents: [] }),
      workspace: () => ({ currentWorkspaceId: null, workspaces: [] }),
      workMode: () => ({ mode: 'work' }),
    },
  });
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test.each(['stopped', 'running'] as const)(
  'returning from settings repeatedly remains browsable with an empty %s catalog',
  async state => {
    vi.mocked(refreshMagpieModels).mockResolvedValue({
      status: { state, version: '1' },
      models: [],
      defaultModelId: null,
    });
    const store = makeStore();
    store.dispatch(setDraftPrompt({ sessionId: '__home__', draft: 'Keep my draft' }));
    const settings = vi.fn();
    for (let index = 0; index < 3; index += 1) {
      const view = render(
        <Provider store={store}>
          <CoworkView onRequestAppSettings={settings} />
        </Provider>,
      );
      await screen.findByText('composer');
      expect(settings).not.toHaveBeenCalled();
      expect(refreshMagpieModels).not.toHaveBeenCalled();
      expect(store.getState().cowork.draftPrompts.__home__).toBe('Keep my draft');
      view.unmount();
    }
    expect(coworkService.startSession).not.toHaveBeenCalled();
  },
);

test('explicit submit opens model settings once and returning to home or history does not reopen it', async () => {
  vi.mocked(refreshMagpieModels).mockResolvedValue({
    status: { state: 'stopped', version: '1' },
    models: [],
    defaultModelId: null,
  });
  const store = makeStore();
  const settings = vi.fn();
  store.dispatch(setDraftPrompt({ sessionId: '__home__', draft: 'Keep my draft' }));
  let view = render(
    <Provider store={store}>
      <CoworkView onRequestAppSettings={settings} />
    </Provider>,
  );
  await screen.findByText('composer');
  await act(async () => expect(await submit('Keep my draft')).toBe(false));
  expect(settings).toHaveBeenCalledExactlyOnceWith({
    initialTab: 'model',
    noticeI18nKey: 'magpieCatalogEmpty',
  });
  expect(coworkService.startSession).not.toHaveBeenCalled();
  expect(store.getState().cowork.currentSession).toBeNull();
  view.unmount();
  view = render(
    <Provider store={store}>
      <CoworkView onRequestAppSettings={settings} />
    </Provider>,
  );
  await screen.findByText('composer');
  await act(async () => {
    store.dispatch(
      setCurrentSession({
        id: 'history',
        mode: 'work',
        status: 'completed',
        messages: [],
      } as unknown as CoworkSession),
    );
  });
  expect(screen.getByText('existing work and document')).toBeTruthy();
  await act(async () => {
    store.dispatch(clearCurrentSession());
  });
  expect(screen.getByText('composer')).toBeTruthy();
  expect(settings).toHaveBeenCalledTimes(1);
  expect(refreshMagpieModels).toHaveBeenCalledTimes(1);
  expect(store.getState().cowork.draftPrompts.__home__).toBe('Keep my draft');
  view.unmount();
});

test('catalog refresh rejection on submit preserves draft and permits retry without creating work', async () => {
  vi.mocked(refreshMagpieModels).mockRejectedValue(new Error('catalog unavailable'));
  const store = makeStore();
  const settings = vi.fn();
  store.dispatch(setDraftPrompt({ sessionId: '__home__', draft: 'Keep my draft' }));
  render(
    <Provider store={store}>
      <CoworkView onRequestAppSettings={settings} />
    </Provider>,
  );
  await screen.findByText('composer');
  for (let index = 0; index < 2; index += 1) {
    await act(async () => expect(await submit('Keep my draft')).toBe(false));
  }
  expect(refreshMagpieModels).toHaveBeenCalledTimes(2);
  expect(showAppErrorToast).toHaveBeenCalledWith('magpieActionFailed');
  expect(settings).not.toHaveBeenCalled();
  expect(coworkService.startSession).not.toHaveBeenCalled();
  expect(store.getState().cowork.currentSession).toBeNull();
  expect(store.getState().cowork.draftPrompts.__home__).toBe('Keep my draft');
});
