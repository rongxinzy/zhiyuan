import { AgentId } from '@shared/agent';

import { AppUpdateStatus } from '../../shared/appUpdate/constants';
import { ManagedProviderAccessMode } from '../../shared/managedProviders';
import { CONFIG_KEYS, defaultConfig } from '../config';

const noopUnsub = () => () => undefined;

const demoWorkspace = {
  id: 'preview-workspace',
  name: '示例项目',
  path: '/Users/demo/示例项目',
  isHidden: false,
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

const demoAgent = {
  id: AgentId.Main,
  name: 'Main',
  description: '浏览器预览内置 Agent',
  icon: '',
  model: 'preview-model',
  workingDirectory: demoWorkspace.path,
  enabled: true,
  pinned: false,
  pinOrder: null,
  isDefault: true,
  source: 'package' as const,
  presetId: '',
  systemPrompt: '',
};

/** In-memory IPC stub for running the renderer in a normal browser. */
export function createBrowserPreviewElectronMock(): Window['electron'] {
  const memory = new Map<string, unknown>();
  memory.set(CONFIG_KEYS.APP_CONFIG, structuredClone(defaultConfig));

  const magpieCatalog = {
    status: {
      state: 'stopped' as const,
      version: 'preview',
      enabled: false,
    },
    models: [
      {
        id: 'preview-model',
        display_name: '预览模型',
        context_window: 128_000,
      },
    ],
    defaultModelId: 'preview-model',
  };

  const coworkConfig = {
    workingDirectory: demoWorkspace.path,
    permissionMode: 'ask' as const,
    permissionModeBySession: {},
  };

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
      getVersion: async () => 'preview',
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
      catalog: async () => magpieCatalog,
      selectDefault: async () => magpieCatalog,
      status: async () => magpieCatalog.status,
      start: async () => magpieCatalog.status,
      stop: async () => magpieCatalog.status,
      agents: async () => ({ agents: [], pending: false }),
      setModel: async () => ({ agents: [], pending: false }),
      models: async () => magpieCatalog.models,
      openManagement: async () => undefined,
      setSubscriptionAccounts: async () => magpieCatalog.status,
    },
    activity: {
      list: async () => ({ success: true, runs: [] }),
      onUpdated: noopUnsub,
    },
    agents: {
      list: async () => [demoAgent],
      create: async () => demoAgent,
      update: async () => demoAgent,
      delete: async () => ({ success: true }),
    },
    cowork: {
      getConfig: async () => ({ success: true, config: coworkConfig }),
      setConfig: async () => ({ success: true }),
      listWorkspaces: async () => ({ success: true, workspaces: [demoWorkspace] }),
      listSessions: async () => ({ success: true, sessions: [], hasMore: false }),
      loadSession: async () => ({ success: false, error: 'preview' }),
      deleteSession: async () => ({ success: true }),
      deleteSessions: async () => ({ success: true }),
      respondToPermission: async () => ({ success: true }),
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
      status: async () => ({ running: false, models: [] }),
      getServiceConfig: async () => ({}),
      setServiceConfig: async () => ({ success: true }),
      listLocalModels: async () => ({ success: true, models: [] }),
      listRunningModels: async () => ({ success: true, models: [] }),
      onModelBindingsChanged: noopUnsub,
      onInstallProgress: noopUnsub,
      onRuntimeStateChanged: noopUnsub,
      onStatusChanged: noopUnsub,
      onPullProgress: noopUnsub,
      onModelLaunchLog: noopUnsub,
      onModelLaunchLogCleared: noopUnsub,
      onModelLaunchLogWindowTargetChanged: noopUnsub,
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
    },
    history: {
      listRecords: async () => ({ success: true, records: [] }),
      getSettings: async () => ({ success: true, settings: {} }),
      setSettings: async () => ({ success: true }),
    },
    todo: {
      onChanged: noopUnsub,
      list: async () => ({ success: true, todos: [] }),
      create: async () => ({ success: true }),
      update: async () => ({ success: true }),
      delete: async () => ({ success: true }),
      listLists: async () => ({ success: true, lists: [] }),
      createList: async () => ({ success: true }),
      updateList: async () => ({ success: true }),
      deleteList: async () => ({ success: true }),
      createStep: async () => ({ success: true }),
      updateStep: async () => ({ success: true }),
      deleteStep: async () => ({ success: true }),
    },
    scheduledTasks: {
      list: async () => ({ success: true, tasks: [] }),
      create: async () => ({ success: true }),
      update: async () => ({ success: true }),
      delete: async () => ({ success: true }),
      runNow: async () => ({ success: true }),
      onUpdated: noopUnsub,
    },
    codingAgent: {
      listWorkspaces: async () => ({ success: true, workspaces: [] }),
      listProfiles: async () => ({ success: true, profiles: [] }),
      listRooms: async () => ({ success: true, rooms: [] }),
      onChanged: noopUnsub,
      onEventDelta: noopUnsub,
      onAuthTerminalData: noopUnsub,
      onAuthTerminalExit: noopUnsub,
      onPendingMessagesChanged: noopUnsub,
    },
    project: {
      getDefaultBaseDir: async () => ({ success: true, path: demoWorkspace.path }),
      createRandomWorkspace: async () => ({ success: true, workspace: demoWorkspace }),
    },
    dialog: {
      readFileAsDataUrl: async () => ({ success: false }),
    },
    shell: {
      openExternal: async () => undefined,
      showItemInFolder: async () => undefined,
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
    },
    permissions: {
      get: async () => ({ mode: 'ask' }),
    },
    marketplace: {
      search: async () => ({ success: true, models: [] }),
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
      listModels: async () => ({ success: true, models: [] }),
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
    },
    generateSessionTitle: async () => '预览会话',
    getRecentCwds: async () => [],
  };

  return electron as unknown as Window['electron'];
}
