import { AppUpdateStatus } from '../../shared/appUpdate/constants';
import { ManagedProviderAccessMode } from '../../shared/managedProviders';
import { CONFIG_KEYS, defaultConfig, type AppConfig } from '../config';

import { runBrowserPreviewTaskBoardCommentDemo } from './browserPreviewTaskBoardDemo';
import { browserPreviewBriefingRuntime } from './browserPreviewBriefingScenarios';
import {
  BrowserPreviewFixtureId,
  browserPreviewAgents,
  browserPreviewLlamaStatus,
  browserPreviewLocalModels,
  browserPreviewMagpieCatalog,
  browserPreviewModelsDir,
  browserPreviewScheduledTasks,
  browserPreviewWorkspaces,
  createBrowserPreviewDurableState,
  filterBrowserPreviewSessionSummaries,
  getBrowserPreviewSession,
} from './browserPreviewFixtures';

const noopUnsub = () => () => undefined;

function readSeedAppConfig(): AppConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEYS.APP_CONFIG);
    if (raw) {
      return { ...defaultConfig, ...JSON.parse(raw) };
    }
  } catch {
    // Ignore malformed preview storage and fall back to defaults.
  }
  return structuredClone(defaultConfig);
}

/** In-memory IPC stub for running the renderer in a normal browser. */
export function createBrowserPreviewElectronMock(): Window['electron'] {
  const memory = new Map<string, unknown>();
  memory.set(CONFIG_KEYS.APP_CONFIG, readSeedAppConfig());
  memory.set('workspace.currentId', BrowserPreviewFixtureId.WorkspaceMain);

  const primaryWorkspace = browserPreviewWorkspaces[0];
  const coworkConfig = {
    workingDirectory: primaryWorkspace.path,
    systemPrompt: '',
    executionMode: 'auto' as const,
    permissionMode: 'ask' as const,
    permissionModeBySession: {},
    embeddingEnabled: false,
    embeddingProvider: '',
    embeddingModel: '',
    embeddingLocalModelPath: '',
    embeddingVectorWeight: 0.5,
    embeddingRemoteBaseUrl: '',
    embeddingRemoteApiKey: '',
  };

  const runningLocalModels = browserPreviewLocalModels.filter(model => model.status === 'loaded');
  const durableState = createBrowserPreviewDurableState();

  const electron = {
    platform: 'darwin',
    arch: 'arm64',
    store: {
      get: async (key: string) => (memory.has(key) ? memory.get(key) : null),
      set: async (key: string, value: unknown) => {
        memory.set(key, value);
      },
      remove: async (key: string) => {
        memory.delete(key);
      },
    },
    appInfo: {
      getVersion: async () => '2026.10.0-preview',
      getSystemLocale: async () => 'zh-CN',
      relaunch: async () => undefined,
      consumePendingLocalInferenceInstall: async () => null,
      isDev: true,
      isEnterprise: false,
    },
    enterprise: {
      getConfig: async () => null,
      renderer: {
        sessionGateEntrypoint: async () => null,
        settingsPages: async () => [],
      },
      session: {
        snapshot: async () => ({ ok: true, snapshot: { status: 'anonymous' as const } }),
        logout: async () => ({ ok: true, snapshot: { status: 'anonymous' as const } }),
      },
    },
    managedProviders: {
      policy: async () => ({
        mode: ManagedProviderAccessMode.Open,
        providers: [],
      }),
      onChanged: noopUnsub,
    },
    magpie: {
      catalog: async () => browserPreviewMagpieCatalog,
      selectDefault: async () => browserPreviewMagpieCatalog,
      status: async () => browserPreviewMagpieCatalog.status,
      start: async () => browserPreviewMagpieCatalog.status,
      stop: async () => ({ ...browserPreviewMagpieCatalog.status, state: 'stopped' as const }),
      agents: async () => ({
        agents: browserPreviewAgents.map(agent => ({
          agentId: agent.id,
          modelId: agent.model,
        })),
        pending: false,
      }),
      setModel: async () => ({
        agents: browserPreviewAgents.map(agent => ({
          agentId: agent.id,
          modelId: agent.model,
        })),
        pending: false,
      }),
      models: async () => browserPreviewMagpieCatalog.models,
      openManagement: async () => undefined,
      setSubscriptionAccounts: async () => browserPreviewMagpieCatalog.status,
    },
    taskBoard: {
      onWorkEvent: (
        callback: (event: import('../../shared/taskBoard/constants').TaskBoardWorkEvent) => void,
      ) => {
        const handler = (event: Event) => {
          callback((event as CustomEvent).detail);
        };
        window.addEventListener('browser-preview:task-board-work-event', handler);
        return () => window.removeEventListener('browser-preview:task-board-work-event', handler);
      },
    },
    activity: {
      list: async () => {
        const { activityListDelayMs, activityListSuccess, activityRuns } =
          browserPreviewBriefingRuntime.config;
        if (activityListDelayMs > 0) {
          await new Promise(resolve => setTimeout(resolve, activityListDelayMs));
        }
        if (!activityListSuccess) {
          return { success: false as const, runs: [] };
        }
        return { success: true as const, runs: activityRuns };
      },
      onUpdated: noopUnsub,
    },
    agents: {
      list: async () => browserPreviewAgents,
      create: async () => browserPreviewAgents[0],
      update: async () => browserPreviewAgents[0],
      delete: async () => ({ success: true }),
    },
    cowork: {
      getConfig: async () => ({ success: true, config: coworkConfig }),
      setConfig: async () => ({ success: true }),
      listWorkspaces: async () => ({ success: true, workspaces: browserPreviewWorkspaces }),
      createWorkspace: async (options: { path: string; name: string }) => ({
        success: true,
        workspace: {
          id: `preview-ws-${Date.now()}`,
          name: options.name,
          path: options.path,
          isHidden: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      }),
      ensureWorkspace: async (options: { path: string; name?: string; isHidden?: boolean }) => ({
        success: true,
        workspace: {
          id: `preview-ws-${Date.now()}`,
          name: options.name ?? options.path.split('/').pop() ?? '工作区',
          path: options.path,
          isHidden: options.isHidden ?? false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      }),
      listSessions: async (
        options?: Parameters<typeof filterBrowserPreviewSessionSummaries>[0],
      ) => {
        const { sessions, hasMore } = filterBrowserPreviewSessionSummaries({
          ...options,
          summaries: browserPreviewBriefingRuntime.config.sessionSummaries,
        });
        return { success: true, sessions, hasMore };
      },
      getSession: async (sessionId: string) => {
        const session = getBrowserPreviewSession(sessionId);
        if (!session) return { success: false, error: 'Session not found in browser preview' };
        return { success: true, session };
      },
      getSessionMessages: async (options: {
        sessionId: string;
        limit?: number;
        offset?: number;
      }) => {
        const session = getBrowserPreviewSession(options.sessionId);
        if (!session) return { success: false, error: 'Session not found' };
        const offset = options.offset ?? 0;
        const limit = options.limit ?? session.messages.length;
        const messages = session.messages.slice(offset, offset + limit);
        return {
          success: true,
          messages,
          offset,
          total: session.totalMessages,
        };
      },
      getRuntimeSnapshots: async () => [],
      getDurableWork: async (sessionId: string) => {
        const snapshot = durableState.getDurableWork(sessionId);
        return snapshot ? { success: true, snapshot } : { success: true };
      },
      resumeDurableWork: async (sessionId: string) => {
        durableState.resumeDurableWork(sessionId);
        return { success: true };
      },
      replayContent: async () => ({ success: true }),
      getWorkDocument: async (sessionId: string) => {
        const data = durableState.getWorkDocument(sessionId);
        return data
          ? { success: true, data }
          : { success: false, error: 'Work document not found in browser preview' };
      },
      updateWorkDocument: async (
        sessionId: string,
        patch: Parameters<typeof durableState.updateWorkDocument>[1],
      ) => {
        const data = durableState.updateWorkDocument(sessionId, patch);
        return data
          ? { success: true, data }
          : { success: false, error: 'Work document revision conflict in browser preview' };
      },
      compactSession: async () => ({ success: true }),
      exportSessionText: async () => ({
        success: true,
        canceled: false,
        path: '/tmp/preview-export.txt',
      }),
      onSessionsChanged: noopUnsub,
      deleteSession: async () => ({ success: true }),
      deleteSessions: async () => ({ success: true }),
      respondToPermission: async () => ({ success: true }),
      continueSession: async (options: { sessionId: string; prompt: string }) => {
        runBrowserPreviewTaskBoardCommentDemo(options.sessionId, options.prompt);
        return { success: true };
      },
      onStreamUiEvent: noopUnsub,
      onStreamMessage: noopUnsub,
      onStreamMessageUpdate: noopUnsub,
      onStreamContentPatch: noopUnsub,
      onStreamPermissionRequest: noopUnsub,
      onStreamComplete: noopUnsub,
      onStreamError: noopUnsub,
      listPendingMessages: async () => ({ success: true, items: [] }),
      enqueuePendingMessage: async () => ({ success: true }),
      updatePendingMessage: async () => ({ success: true }),
      deletePendingMessage: async () => ({ success: true }),
      steerPendingMessage: async () => ({ success: true }),
      followUpPendingMessage: async () => ({ success: true }),
      onWorkDocumentChanged: noopUnsub,
    },
    llamacpp: {
      status: async () => browserPreviewLlamaStatus,
      getServiceConfig: async () => ({
        modelsMax: 2,
        gatewayAccessMode: 'local',
      }),
      setServiceConfig: async () => ({ success: true }),
      modelsDir: async () => browserPreviewModelsDir,
      setModelsDir: async (dir: string) => dir,
      listLocalModels: async () => browserPreviewLocalModels,
      listRunningModels: async () => runningLocalModels,
      getModelPreferences: async () => ({}),
      setModelPreference: async () => ({}),
      onModelBindingsChanged: noopUnsub,
      onInstallProgress: noopUnsub,
      onRuntimeStateChanged: noopUnsub,
      onStatusChanged: noopUnsub,
      onPullProgress: noopUnsub,
      onModelLaunchLog: noopUnsub,
      onModelLaunchLogCleared: noopUnsub,
      onModelLaunchLogWindowTargetChanged: noopUnsub,
      installModel: async () => ({ success: false, error: 'Browser preview' }),
      loadModel: async () => ({ success: false, error: 'Browser preview' }),
      cancelModelLoad: async () => ({ success: true }),
      unloadModel: async () => ({ success: true }),
      deleteModel: async () => ({ success: true }),
      cancelInstall: async () => ({ success: true }),
    },
    ollama: {
      status: async () => ({ running: false }),
      listLocalModels: async () => [],
      listRunningModels: async () => [],
    },
    auth: {
      communityLogin: async () => ({ success: true }),
      getCommunityUser: async () => ({ success: false }),
      communityLogout: async () => ({ success: true }),
      onCommunityCallback: noopUnsub,
    },
    appUpdate: {
      getState: async () => ({
        status: AppUpdateStatus.Idle,
        info: null,
      }),
      onStateChanged: noopUnsub,
      checkNow: async () => ({ success: true }),
      cancelDownload: async () => ({ success: true }),
      installReady: async () => ({ success: false }),
      revealDownload: async () => ({ success: false }),
      retryDownload: async () => ({ success: true }),
    },
    history: {
      listRecords: async () => ({
        success: true,
        records: [
          {
            id: 'history-1',
            title: '浏览器预览 · 侧栏走查',
            updatedAt: Date.now(),
            messageCount: 12,
          },
        ],
      }),
      getSettings: async () => ({ success: true, settings: { enabled: true, retentionDays: 30 } }),
      setSettings: async () => ({ success: true }),
    },
    todo: {
      onChanged: noopUnsub,
      list: async () => ({
        success: true,
        todos: [
          {
            id: 'todo-1',
            listId: 'list-inbox',
            title: '补全浏览器预览夹具',
            completed: false,
            priority: 1,
            dueDate: null,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        ],
      }),
      create: async () => ({ success: true }),
      update: async () => ({ success: true }),
      delete: async () => ({ success: true }),
      listLists: async () => ({
        success: true,
        lists: [{ id: 'list-inbox', name: '收件箱', createdAt: Date.now(), updatedAt: Date.now() }],
      }),
      createList: async () => ({ success: true }),
      updateList: async () => ({ success: true }),
      deleteList: async () => ({ success: true }),
      createStep: async () => ({ success: true }),
      updateStep: async () => ({ success: true }),
      deleteStep: async () => ({ success: true }),
    },
    scheduledTasks: {
      list: async () => ({
        success: true,
        tasks: browserPreviewBriefingRuntime.config.scheduledTasks,
      }),
      get: async (id: string) => {
        const task = browserPreviewScheduledTasks.find(entry => entry.id === id);
        return task
          ? { success: true, task }
          : { success: false, error: 'Task not found in browser preview' };
      },
      create: async () => ({ success: true }),
      update: async () => ({ success: true }),
      delete: async () => ({ success: true }),
      toggle: async () => ({ success: true }),
      runManually: async () => ({ success: true }),
      stop: async () => ({ success: true }),
      listRuns: async () => ({ success: true, runs: [] }),
      countRuns: async () => ({ success: true, count: 0 }),
      listAllRuns: async () => ({ success: true, runs: [] }),
      resolveSession: async () => ({ success: true, session: null }),
      onStatusUpdate: noopUnsub,
      onRunUpdate: noopUnsub,
      onRefresh: noopUnsub,
    },
    codingAgent: {
      listWorkspaces: async () => ({
        success: true,
        workspaces: [
          {
            id: 'coding-ws-1',
            name: 'zhiyuan-agent',
            path: primaryWorkspace.path,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        ],
      }),
      listProfiles: async () => ({
        success: true,
        profiles: [{ id: 'default', name: '默认配置', isDefault: true }],
      }),
      listRooms: async () => ({
        success: true,
        rooms: [
          {
            id: 'coding-room-1',
            workspaceId: 'coding-ws-1',
            title: '修复预览 mock 类型',
            status: 'idle',
            updatedAt: Date.now(),
          },
        ],
      }),
      onChanged: noopUnsub,
      onEventDelta: noopUnsub,
      onAuthTerminalData: noopUnsub,
      onAuthTerminalExit: noopUnsub,
      onPendingMessagesChanged: noopUnsub,
    },
    project: {
      getDefaultBaseDir: async () => ({ success: true, path: primaryWorkspace.path }),
      createRandomWorkspace: async () => ({ success: true, workspace: primaryWorkspace }),
    },
    dialog: {
      readFileAsDataUrl: async () => ({ success: false }),
      selectDirectory: async () => ({ canceled: true }),
    },
    shell: {
      openExternal: async () => undefined,
      showItemInFolder: async () => undefined,
      openPath: async () => ({ success: true }),
    },
    runtimeNotices: {
      onNotice: noopUnsub,
    },
    networkStatus: {
      send: () => undefined,
    },
    devNetwork: {
      onEntry: noopUnsub,
    },
    appEvents: {
      onOpenSettings: noopUnsub,
      onNewTask: noopUnsub,
    },
    triage: {
      getConfig: async () => ({ enabled: false }),
      setConfig: async () => ({ success: true }),
    },
    hardware: {
      snapshot: async () => ({
        success: true,
        memory: { totalBytes: 16_000_000_000, usedBytes: 8_000_000_000 },
      }),
      systemMemory: async () => ({
        source: 'system' as const,
        available: true,
        checkedAt: new Date().toISOString(),
        totalMemoryMiB: 16_384,
        freeMemoryMiB: 8_192,
      }),
      nvidiaSmi: async () => ({
        source: 'nvidia-smi' as const,
        available: false,
        checkedAt: new Date().toISOString(),
        gpus: [],
      }),
    },
    permissions: {
      get: async () => ({ mode: 'ask' }),
    },
    marketplace: {
      search: async () => ({ success: true, models: [], requestId: 'preview' }),
      cancelSearch: async () => ({ cancelled: true }),
    },
    api: {
      fetch: async () => ({
        ok: false,
        status: 503,
        statusText: 'Browser preview',
        headers: {},
        data: null,
        error: 'Browser preview does not call remote APIs.',
      }),
    },
    modelPool: {
      listModels: async () => ({ success: true, models: browserPreviewMagpieCatalog.models }),
      stream: async () => ({ success: false }),
      cancelStream: async () => ({ success: true }),
      onStreamData: noopUnsub,
      onStreamDone: noopUnsub,
      onStreamError: noopUnsub,
      onStreamAbort: noopUnsub,
    },
    autoLaunch: {
      get: async () => false,
      set: async () => ({ success: true }),
    },
    preventSleep: {
      get: async () => false,
      set: async () => ({ success: true }),
    },
    contextMenu: {
      onOpen: noopUnsub,
    },
    window: {
      minimize: async () => undefined,
      maximize: async () => undefined,
      close: async () => undefined,
      isMaximized: async () => false,
      onStateChanged: noopUnsub,
    },
    log: {
      fromRenderer: () => undefined,
      exportZip: async () => ({ success: false, error: 'Browser preview' }),
    },
    generateSessionTitle: async () => '预览会话',
    getRecentCwds: async () => [primaryWorkspace.path],
  };

  return electron as unknown as Window['electron'];
}
