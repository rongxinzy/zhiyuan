import { HistoryIpc, type HistoryApi } from '../shared/history';
import { contextBridge, ipcRenderer } from 'electron';
import { MagpieIpc, type MagpieModelSelection } from '../shared/magpie/types';

import type { ContextMenuAction, ContextMenuOpenEvent } from '../shared/contextMenu';
import type { ApiRequestPurpose } from '../shared/ipc/apiRequest';
import { IpcChannel as ScheduledTaskIpc } from '../scheduledTask/constants';
import { AgentIpcChannel } from '../shared/agent/constants';
import { AppUpdateIpc } from '../shared/appUpdate/constants';
import { ActivityIpc } from '../shared/activity/constants';
import type { ActivityRun } from '../shared/activity/types';
import {
  ApiIpc,
  AppConfigIpc,
  AppIpc,
  CommunityAuthIpc,
  ContextMenuIpc,
  CoworkConfigIpc,
  CoworkPermissionIpc,
  CoworkQueueIpc,
  CoworkSessionIpc,
  CoworkStreamIpc,
  DialogIpc,
  EnterpriseIpc,
  HardwareIpc,
  LogIpc,
  ManagedProviderIpc,
  ModelPoolIpc,
  NetworkIpc,
  DevNetworkIpc,
  PermissionsIpc,
  ProjectIpc,
  ShellIpc,
  StoreIpc,
  WindowIpc,
} from '../shared/ipc/channels';
import type {
  CoworkExecutionMode,
  CoworkPermissionMode,
  CoworkSessionMode,
  CoworkSessionSource,
} from '../shared/cowork/constants';
import type { CoworkContentPatch } from '../shared/cowork/contentProjection';
import { LlamaCppIpcChannel } from '../shared/llamacpp/constants';
import { MarketplaceIpcChannel } from '../shared/marketplace/constants';
import type { MarketplaceSearchRequest } from '../shared/marketplace/types';
import { OllamaIpcChannel } from '../shared/ollama/constants';
import { EnterpriseSessionIpc } from '../shared/enterpriseSession';
import { EnterpriseRendererIpc } from '../shared/enterpriseRenderer';
import { TriageIpcChannel } from '../shared/triage';
import { TodoIpc } from '../shared/todo';
import { WorkspaceIpc } from '../shared/workspace';
import { CodingAgentIpc } from '../shared/codingAgent';
import { RuntimeNoticeIpc } from '../shared/ipc/channels';

// Helper: typed main→renderer push listener with automatic cleanup
const onPush = <T>(channel: string, callback: (data: T) => void): (() => void) => {
  const handler = (_event: Electron.IpcRendererEvent, data: T) => callback(data);
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
};

// Helper: typed main→renderer push listener with no data payload
const onPushVoid = (channel: string, callback: () => void): (() => void) => {
  const handler = () => callback();
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
};

// ─── Exposed API ────────────────────────────────────────────────────────────
contextBridge.exposeInMainWorld('electron', {
  platform: process.platform,
  arch: process.arch,

  store: {
    get: (key: string) => ipcRenderer.invoke(StoreIpc.Get, key),
    set: (key: string, value: unknown) => ipcRenderer.invoke(StoreIpc.Set, key, value),
    remove: (key: string) => ipcRenderer.invoke(StoreIpc.Remove, key),
  },

  ollama: {
    status: () => ipcRenderer.invoke(OllamaIpcChannel.Status),
    install: () => ipcRenderer.invoke(OllamaIpcChannel.Install),
    start: () => ipcRenderer.invoke(OllamaIpcChannel.Start),
    stop: () => ipcRenderer.invoke(OllamaIpcChannel.Stop),
    restart: () => ipcRenderer.invoke(OllamaIpcChannel.Restart),
    getServiceConfig: () => ipcRenderer.invoke(OllamaIpcChannel.GetServiceConfig),
    setServiceConfig: (config: unknown) =>
      ipcRenderer.invoke(OllamaIpcChannel.SetServiceConfig, config),
    modelsDir: () => ipcRenderer.invoke(OllamaIpcChannel.ModelsDir),
    listLocalModels: () => ipcRenderer.invoke(OllamaIpcChannel.ListLocalModels),
    listRunningModels: () => ipcRenderer.invoke(OllamaIpcChannel.ListRunningModels),
    deleteModel: (name: string) => ipcRenderer.invoke(OllamaIpcChannel.DeleteModel, name),
    showModel: (name: string) => ipcRenderer.invoke(OllamaIpcChannel.ShowModel, name),
    createModel: (name: string, modelfile: string) =>
      ipcRenderer.invoke(OllamaIpcChannel.CreateModel, name, modelfile),
    preloadModel: (input: unknown) => ipcRenderer.invoke(OllamaIpcChannel.PreloadModel, input),
    unloadModel: (name: string) => ipcRenderer.invoke(OllamaIpcChannel.UnloadModel, name),
    pullModel: (name: string) => ipcRenderer.invoke(OllamaIpcChannel.PullModel, name),
    cancelPull: (name: string) => ipcRenderer.invoke(OllamaIpcChannel.CancelPull, name),
    chat: (payload: unknown) => ipcRenderer.invoke(OllamaIpcChannel.Chat, payload),
    chatStream: (requestId: string, payload: unknown) =>
      ipcRenderer.invoke(OllamaIpcChannel.ChatStream, requestId, payload),
    cancelChatStream: (requestId: string) =>
      ipcRenderer.invoke(OllamaIpcChannel.CancelChatStream, requestId),
    onStatusChanged: (callback: (snapshot: unknown) => void) =>
      onPush(OllamaIpcChannel.StatusChanged, callback),
    onInstallProgress: (callback: (progress: unknown) => void) =>
      onPush(OllamaIpcChannel.InstallProgress, callback),
    onPullProgress: (callback: (payload: unknown) => void) =>
      onPush(OllamaIpcChannel.PullProgress, callback),
    onChatStreamChunk: (callback: (payload: unknown) => void) =>
      onPush(OllamaIpcChannel.ChatStreamChunk, callback),
  },

  llamacpp: {
    status: () => ipcRenderer.invoke(LlamaCppIpcChannel.Status),
    install: () => ipcRenderer.invoke(LlamaCppIpcChannel.Install),
    cancelRuntimeInstall: () => ipcRenderer.invoke(LlamaCppIpcChannel.CancelRuntimeInstall),
    uninstallRuntime: () => ipcRenderer.invoke(LlamaCppIpcChannel.UninstallRuntime),
    listRuntimeDevices: (input?: unknown) =>
      ipcRenderer.invoke(LlamaCppIpcChannel.ListRuntimeDevices, input),
    listBackends: () => ipcRenderer.invoke(LlamaCppIpcChannel.ListBackends),
    getBackendDownloadSize: (input: unknown) =>
      ipcRenderer.invoke(LlamaCppIpcChannel.GetBackendDownloadSize, input),
    getBackendSelection: () => ipcRenderer.invoke(LlamaCppIpcChannel.GetBackendSelection),
    setBackendSelection: (input: unknown) =>
      ipcRenderer.invoke(LlamaCppIpcChannel.SetBackendSelection, input),
    installBackend: (input?: unknown) =>
      ipcRenderer.invoke(LlamaCppIpcChannel.InstallBackend, input),
    getRuntimeInstallSnapshot: () =>
      ipcRenderer.invoke(LlamaCppIpcChannel.GetRuntimeInstallSnapshot),
    uninstallBackend: (input?: unknown) =>
      ipcRenderer.invoke(LlamaCppIpcChannel.UninstallBackend, input),
    getRuntimeCapabilities: () => ipcRenderer.invoke(LlamaCppIpcChannel.GetRuntimeCapabilities),
    importRuntime: () => ipcRenderer.invoke(LlamaCppIpcChannel.ImportRuntime),
    start: () => ipcRenderer.invoke(LlamaCppIpcChannel.Start),
    stop: () => ipcRenderer.invoke(LlamaCppIpcChannel.Stop),
    restart: () => ipcRenderer.invoke(LlamaCppIpcChannel.Restart),
    getServiceConfig: () => ipcRenderer.invoke(LlamaCppIpcChannel.GetServiceConfig),
    setServiceConfig: (config: unknown) =>
      ipcRenderer.invoke(LlamaCppIpcChannel.SetServiceConfig, config),
    getGatewayLanToken: () => ipcRenderer.invoke(LlamaCppIpcChannel.GetGatewayLanToken),
    regenerateGatewayLanToken: () =>
      ipcRenderer.invoke(LlamaCppIpcChannel.RegenerateGatewayLanToken),
    modelsDir: () => ipcRenderer.invoke(LlamaCppIpcChannel.ModelsDir),
    setModelsDir: (modelsDir: string) =>
      ipcRenderer.invoke(LlamaCppIpcChannel.SetModelsDir, modelsDir),
    listLocalModels: () => ipcRenderer.invoke(LlamaCppIpcChannel.ListLocalModels),
    listRunningModels: () => ipcRenderer.invoke(LlamaCppIpcChannel.ListRunningModels),
    refreshRunningModelBindings: () =>
      ipcRenderer.invoke(LlamaCppIpcChannel.RefreshRunningModelBindings),
    importModelFiles: (paths: string[]) =>
      ipcRenderer.invoke(LlamaCppIpcChannel.ImportModelFiles, paths),
    deleteModel: (name: string) => ipcRenderer.invoke(LlamaCppIpcChannel.DeleteModel, name),
    showModel: (name: string) => ipcRenderer.invoke(LlamaCppIpcChannel.ShowModel, name),
    getModelPreferences: () => ipcRenderer.invoke(LlamaCppIpcChannel.GetModelPreferences),
    setModelPreference: (input: unknown) =>
      ipcRenderer.invoke(LlamaCppIpcChannel.SetModelPreference, input),
    loadModel: (input: unknown) => ipcRenderer.invoke(LlamaCppIpcChannel.LoadModel, input),
    cancelModelLoad: (modelName?: string) =>
      ipcRenderer.invoke(LlamaCppIpcChannel.CancelModelLoad, modelName),
    unloadModel: (name: string) => ipcRenderer.invoke(LlamaCppIpcChannel.UnloadModel, name),
    getLatestModelLaunchLogSession: (input?: unknown) =>
      ipcRenderer.invoke(LlamaCppIpcChannel.GetLatestModelLaunchLogSession, input),
    readModelLaunchLogFile: (input: unknown) =>
      ipcRenderer.invoke(LlamaCppIpcChannel.ReadModelLaunchLogFile, input),
    openModelLaunchLogWindow: (input?: unknown) =>
      ipcRenderer.invoke(LlamaCppIpcChannel.OpenModelLaunchLogWindow, input),
    installModel: (input: unknown) => ipcRenderer.invoke(LlamaCppIpcChannel.InstallModel, input),
    cancelInstall: (modelId: string) =>
      ipcRenderer.invoke(LlamaCppIpcChannel.CancelInstall, modelId),
    onStatusChanged: (callback: (snapshot: unknown) => void) =>
      onPush(LlamaCppIpcChannel.StatusChanged, callback),
    onModelBindingsChanged: (callback: () => void) =>
      onPushVoid(LlamaCppIpcChannel.ModelBindingsChanged, callback),
    onInstallProgress: (callback: (progress: unknown) => void) =>
      onPush(LlamaCppIpcChannel.InstallProgress, callback),
    onModelLaunchLog: (callback: (event: unknown) => void) =>
      onPush(LlamaCppIpcChannel.ModelLaunchLog, callback),
    onModelLaunchLogCleared: (callback: (event: unknown) => void) =>
      onPush(LlamaCppIpcChannel.ModelLaunchLogCleared, callback),
    onModelLaunchLogWindowTargetChanged: (callback: (target: unknown) => void) =>
      onPush(LlamaCppIpcChannel.ModelLaunchLogWindowTargetChanged, callback),
    onPullProgress: (
      callback: (payload: { name: string; chunk: Record<string, unknown> }) => void,
    ) => {
      const handler = (_event: Electron.IpcRendererEvent, progress: any) => {
        const name = String(progress?.modelId || progress?.modelName || '');
        callback({ name, chunk: { ...progress, status: progress?.phase } });
      };
      ipcRenderer.on(LlamaCppIpcChannel.InstallProgress, handler);
      return () => {
        ipcRenderer.removeListener(LlamaCppIpcChannel.InstallProgress, handler);
      };
    },
  },
  marketplace: {
    search: (request: MarketplaceSearchRequest) =>
      ipcRenderer.invoke(MarketplaceIpcChannel.Search, request),
    cancelSearch: (requestId: string) =>
      ipcRenderer.invoke(MarketplaceIpcChannel.CancelSearch, requestId),
  },

  triage: {
    getConfig: () => ipcRenderer.invoke(TriageIpcChannel.GetConfig),
    setConfig: (config: unknown) => ipcRenderer.invoke(TriageIpcChannel.SetConfig, config),
  },

  hardware: {
    nvidiaSmi: () => ipcRenderer.invoke(HardwareIpc.NvidiaSmi),
    systemMemory: () => ipcRenderer.invoke(HardwareIpc.SystemMemory),
  },

  permissions: {
    checkCalendar: () => ipcRenderer.invoke(PermissionsIpc.CheckCalendar),
    requestCalendar: () => ipcRenderer.invoke(PermissionsIpc.RequestCalendar),
  },

  enterprise: {
    getConfig: () => ipcRenderer.invoke(EnterpriseIpc.GetConfig),
    renderer: {
      sessionGateEntrypoint: () =>
        ipcRenderer.invoke(EnterpriseRendererIpc.SessionGateEntrypoint) as Promise<string | null>,
      settingsPages: () =>
        ipcRenderer.invoke(EnterpriseRendererIpc.SettingsPages) as Promise<
          readonly import('../shared/enterpriseRenderer').EnterpriseRendererSettingsPage[]
        >,
    },
    session: {
      snapshot: () => ipcRenderer.invoke(EnterpriseSessionIpc.Snapshot),
      login: (input: unknown) => ipcRenderer.invoke(EnterpriseSessionIpc.Login, input),
      changePassword: (input: unknown) =>
        ipcRenderer.invoke(EnterpriseSessionIpc.ChangePassword, input),
      logout: () => ipcRenderer.invoke(EnterpriseSessionIpc.Logout),
    },
  },

  managedProviders: {
    policy: () =>
      ipcRenderer.invoke(ManagedProviderIpc.Policy) as Promise<
        import('../shared/managedProviders').ManagedProviderAccessPolicy
      >,
    catalog: () =>
      ipcRenderer.invoke(ManagedProviderIpc.Catalog) as Promise<
        readonly import('../shared/managedProviders').ManagedProviderCatalogModel[]
      >,
    onChanged: (callback: () => void) => onPushVoid(ManagedProviderIpc.Changed, callback),
  },

  api: {
    fetch: (options: {
      url: string;
      method: string;
      headers: Record<string, string>;
      body?: string;
      timeoutMs?: number;
      purpose?: ApiRequestPurpose;
    }) => ipcRenderer.invoke(ApiIpc.Fetch, options),
  },

  // Internal app-level events (replaces raw ipcRenderer.on usage in App.tsx)
  appEvents: {
    onOpenSettings: (callback: () => void) => onPushVoid('app:openSettings', callback),
    onNewTask: (callback: () => void) => onPushVoid('app:newTask', callback),
  },

  contextMenu: {
    execute: (action: ContextMenuAction) => ipcRenderer.send(ContextMenuIpc.Execute, action),
    onOpen: (callback: (event: ContextMenuOpenEvent) => void) =>
      onPush<ContextMenuOpenEvent>(ContextMenuIpc.Open, callback),
  },

  window: {
    minimize: () => ipcRenderer.send(WindowIpc.Minimize),
    toggleMaximize: () => ipcRenderer.send(WindowIpc.ToggleMaximize),
    close: () => ipcRenderer.send(WindowIpc.Close),
    isMaximized: () => ipcRenderer.invoke(WindowIpc.IsMaximized),
    showSystemMenu: (position: { x: number; y: number }) =>
      ipcRenderer.send(WindowIpc.ShowSystemMenu, position),
    toggleDevTools: () => ipcRenderer.invoke(WindowIpc.ToggleDevTools), // 切换调试面板
    openDevTools: () => ipcRenderer.invoke(WindowIpc.OpenDevTools),
    onStateChanged: (
      callback: (state: {
        isMaximized: boolean;
        isFullscreen: boolean;
        isFocused: boolean;
      }) => void,
    ) => onPush(WindowIpc.StateChanged, callback),
  },

  generateSessionTitle: (userInput: string | null) =>
    ipcRenderer.invoke(AppConfigIpc.GenerateSessionTitle, userInput),
  getRecentCwds: (limit?: number) => ipcRenderer.invoke(AppConfigIpc.GetRecentCwds, limit),

  agents: {
    list: async () => {
      const result = await ipcRenderer.invoke(AgentIpcChannel.List);
      return result?.success ? result.agents : [];
    },
    get: async (id: string) => {
      const result = await ipcRenderer.invoke(AgentIpcChannel.Get, id);
      return result?.success ? result.agent : null;
    },
    create: async (request: {
      id?: string;
      name: string;
      description?: string;
      systemPrompt?: string;
      identity?: string;
      model?: string;
      workingDirectory?: string;
      icon?: string;
      skillIds?: string[];
      source?: string;
      presetId?: string;
    }) => {
      const result = await ipcRenderer.invoke(AgentIpcChannel.Create, request);
      return result?.success ? result.agent : null;
    },
    update: async (
      id: string,
      updates: {
        name?: string;
        description?: string;
        systemPrompt?: string;
        identity?: string;
        model?: string;
        workingDirectory?: string;
        icon?: string;
        skillIds?: string[];
        enabled?: boolean;
        pinned?: boolean;
      },
    ) => {
      const result = await ipcRenderer.invoke(AgentIpcChannel.Update, id, updates);
      return result?.success ? result.agent : null;
    },
    delete: async (id: string) => {
      const result = await ipcRenderer.invoke(AgentIpcChannel.Delete, id);
      return result?.success ? result.deleted : false;
    },
  },

  magpie: {
    status: () => ipcRenderer.invoke(MagpieIpc.status),
    setSubscriptionAccounts: (enabled: boolean) =>
      ipcRenderer.invoke(MagpieIpc.setSubscriptionAccounts, enabled),
    start: () => ipcRenderer.invoke(MagpieIpc.start),
    stop: () => ipcRenderer.invoke(MagpieIpc.stop),
    agents: () => ipcRenderer.invoke(MagpieIpc.agents),
    setModel: (selection: MagpieModelSelection) =>
      ipcRenderer.invoke(MagpieIpc.setModel, selection),
    models: () => ipcRenderer.invoke(MagpieIpc.models),
    catalog: () => ipcRenderer.invoke(MagpieIpc.catalog),
    selectDefault: (modelId: string) => ipcRenderer.invoke(MagpieIpc.selectDefault, modelId),
    openManagement: () => ipcRenderer.invoke(MagpieIpc.openManagement),
  },
  cowork: {
    getWorkDocument: (sessionId: string) =>
      ipcRenderer.invoke('cowork:workDocument:get', sessionId),
    updateWorkDocument: (
      sessionId: string,
      patch: import('../shared/durable/workDocument').WorkDocumentPatch,
    ) => ipcRenderer.invoke('cowork:workDocument:update', sessionId, patch),
    onWorkDocumentChanged: (
      callback: (change: import('../shared/durable/workDocument').WorkDocumentChanged) => void,
    ) => onPush('cowork:workDocument:changed', callback),
    getDurableWork: (sessionId: string) => ipcRenderer.invoke('cowork:getDurableWork', sessionId),
    resumeDurableWork: (sessionId: string) =>
      ipcRenderer.invoke('cowork:resumeDurableWork', sessionId),
    replayContent: (sessionId: string) =>
      ipcRenderer.invoke(CoworkSessionIpc.ReplayContent, sessionId),
    onStreamContentPatch: (callback: (patch: CoworkContentPatch) => void) =>
      onPush(CoworkStreamIpc.ContentPatch, callback),
    listWorkspaces: () => ipcRenderer.invoke(WorkspaceIpc.List),
    createWorkspace: (options: { path: string; name: string }) =>
      ipcRenderer.invoke(WorkspaceIpc.Create, options),
    ensureWorkspace: (options: { path: string; name?: string }) =>
      ipcRenderer.invoke(WorkspaceIpc.Ensure, options),
    renameWorkspace: (id: string, name: string) =>
      ipcRenderer.invoke(WorkspaceIpc.Rename, id, name),
    updateWorkspace: (options: {
      id: string;
      name?: string;
      primaryPath?: string;
      folders?: string[];
    }) => ipcRenderer.invoke(WorkspaceIpc.Update, options),
    deleteWorkspace: (id: string) => ipcRenderer.invoke(WorkspaceIpc.Delete, id),
    startSession: (options: {
      requestId?: string;
      prompt: string;
      cwd?: string;
      systemPrompt?: string;
      title?: string;
      mode?: CoworkSessionMode;
      goalMode?: boolean;
      activeSkillIds?: string[];
      workspaceId?: string;
      agentId?: string;
      expertIds?: string[];
      modelOverride?: string;
      permissionMode?: CoworkPermissionMode;
      imageAttachments?: Array<{
        name: string;
        mimeType: string;
        base64Data?: string;
        path?: string;
      }>;
      fileAttachments?: Array<{ name: string; path: string; extension: string; isImage?: boolean }>;
    }) => ipcRenderer.invoke(CoworkSessionIpc.Start, options),

    continueSession: (options: {
      requestId?: string;
      sessionId: string;
      prompt: string;
      systemPrompt?: string;
      activeSkillIds?: string[];
      goalMode?: boolean;
      expertIds?: string[];
      permissionMode?: CoworkPermissionMode;
      imageAttachments?: Array<{
        name: string;
        mimeType: string;
        base64Data?: string;
        path?: string;
      }>;
      fileAttachments?: Array<{ name: string; path: string; extension: string; isImage?: boolean }>;
    }) => ipcRenderer.invoke(CoworkSessionIpc.Continue, options),

    listPendingMessages: (sessionId: string) => ipcRenderer.invoke(CoworkQueueIpc.List, sessionId),
    enqueuePendingMessage: (options: {
      requestId?: string;
      sessionId: string;
      text: string;
      imageAttachments?: Array<{
        name: string;
        mimeType: string;
        base64Data?: string;
        path?: string;
      }>;
      fileAttachments?: Array<{ name: string; path: string; extension: string; isImage?: boolean }>;
      skillIds?: string[];
    }) => ipcRenderer.invoke(CoworkQueueIpc.Enqueue, options),
    updatePendingMessage: (options: { sessionId: string; itemId: string; text: string }) =>
      ipcRenderer.invoke(CoworkQueueIpc.Update, options),
    deletePendingMessage: (options: { sessionId: string; itemId: string }) =>
      ipcRenderer.invoke(CoworkQueueIpc.Delete, options),
    steerPendingMessage: (options: { sessionId: string; itemId: string }) =>
      ipcRenderer.invoke(CoworkQueueIpc.Steer, options),
    followUpPendingMessage: (options: { sessionId: string; itemId: string }) =>
      ipcRenderer.invoke(CoworkQueueIpc.FollowUp, options),

    stopSession: (sessionId: string) => ipcRenderer.invoke(CoworkSessionIpc.Stop, sessionId),
    compactSession: (sessionId: string) => ipcRenderer.invoke(CoworkSessionIpc.Compact, sessionId),
    saveSession: (session: Record<string, unknown>) =>
      ipcRenderer.invoke(CoworkSessionIpc.Save, session),
    deleteSession: (sessionId: string) => ipcRenderer.invoke(CoworkSessionIpc.Delete, sessionId),
    deleteSessions: (sessionIds: string[]) =>
      ipcRenderer.invoke(CoworkSessionIpc.DeleteBatch, sessionIds),
    setSessionPinned: (options: { sessionId: string; pinned: boolean }) =>
      ipcRenderer.invoke(CoworkSessionIpc.Pin, options),
    renameSession: (options: { sessionId: string; title: string }) =>
      ipcRenderer.invoke(CoworkSessionIpc.Rename, options),
    updateSessionModel: (options: { sessionId: string; modelOverride: string }) =>
      ipcRenderer.invoke(CoworkSessionIpc.UpdateModel, options),
    getSession: (sessionId: string, options?: { messageLimit?: number | null }) =>
      ipcRenderer.invoke(CoworkSessionIpc.Get, sessionId, options),
    getRuntimeSnapshots: (sessionId?: string) =>
      ipcRenderer.invoke(CoworkStreamIpc.RuntimeSnapshots, sessionId),
    listSessions: (options?: {
      limit?: number;
      offset?: number;
      agentId?: string;
      workspaceId?: string;
      mode?: CoworkSessionMode;
      sources?: CoworkSessionSource[];
    }) => ipcRenderer.invoke(CoworkSessionIpc.List, options),
    getSessionMessages: (options: { sessionId: string; limit?: number; offset?: number }) =>
      ipcRenderer.invoke(CoworkSessionIpc.GetMessages, options),
    exportResultImage: (options: {
      rect: { x: number; y: number; width: number; height: number };
      defaultFileName?: string;
    }) => ipcRenderer.invoke(CoworkSessionIpc.ExportResultImage, options),
    captureImageChunk: (options: {
      rect: { x: number; y: number; width: number; height: number };
    }) => ipcRenderer.invoke(CoworkSessionIpc.CaptureImageChunk, options),
    saveResultImage: (options: { pngBase64: string; defaultFileName?: string }) =>
      ipcRenderer.invoke(CoworkSessionIpc.SaveResultImage, options),
    exportSessionText: (options: {
      content: string;
      defaultFileName?: string;
      fileExtension?: string;
    }) => ipcRenderer.invoke(CoworkSessionIpc.ExportText, options),

    respondToPermission: (options: { requestId: string; result: unknown }) =>
      ipcRenderer.invoke(CoworkPermissionIpc.Respond, options),

    getConfig: () => ipcRenderer.invoke(CoworkConfigIpc.Get),
    setConfig: (config: {
      workingDirectory?: string;
      executionMode?: CoworkExecutionMode;
      permissionMode?: CoworkPermissionMode;
      permissionModeBySession?: Record<string, CoworkPermissionMode>;
      embeddingEnabled?: boolean;
      embeddingProvider?: string;
      embeddingModel?: string;
      embeddingLocalModelPath?: string;
      embeddingVectorWeight?: number;
      embeddingRemoteBaseUrl?: string;
      embeddingRemoteApiKey?: string;
    }) => ipcRenderer.invoke(CoworkConfigIpc.Set, config),

    onStreamUiEvent: (callback: (event: import('../shared/cowork/piUiEvent').PiUiEvent) => void) =>
      onPush(CoworkStreamIpc.UiEvent, callback),
    onSessionsChanged: (
      callback: (data: {
        sessionId?: string;
        deletedSessionIds?: string[];
        agentId?: string;
      }) => void,
    ) => onPush(CoworkStreamIpc.SessionsChanged, callback),
  },

  todo: {
    list: (input: import('../shared/todo').TodoListInput) =>
      ipcRenderer.invoke(TodoIpc.List, input),
    create: (input: import('../shared/todo').TodoCreateInput) =>
      ipcRenderer.invoke(TodoIpc.Create, input),
    update: (input: import('../shared/todo').TodoUpdateInput & { todoId: string }) =>
      ipcRenderer.invoke(TodoIpc.Update, input),
    delete: (todoId: string) => ipcRenderer.invoke(TodoIpc.Delete, todoId),
    listLists: () => ipcRenderer.invoke(TodoIpc.ListLists),
    createList: (input: import('../shared/todo').TodoListCreateInput) =>
      ipcRenderer.invoke(TodoIpc.CreateList, input),
    updateList: (input: import('../shared/todo').TodoListUpdateInput & { listId: string }) =>
      ipcRenderer.invoke(TodoIpc.UpdateList, input),
    deleteList: (listId: string) => ipcRenderer.invoke(TodoIpc.DeleteList, listId),
    createStep: (input: import('../shared/todo').TodoStepCreateInput) =>
      ipcRenderer.invoke(TodoIpc.CreateStep, input),
    updateStep: (input: import('../shared/todo').TodoStepUpdateInput) =>
      ipcRenderer.invoke(TodoIpc.UpdateStep, input),
    deleteStep: (stepId: string) => ipcRenderer.invoke(TodoIpc.DeleteStep, stepId),
    onChanged: (callback: (event: import('../shared/todo').TodoChangedEvent) => void) =>
      onPush(TodoIpc.Changed, callback),
  },

  history: {
    list: request => ipcRenderer.invoke(HistoryIpc.List, request),
    readPage: request => ipcRenderer.invoke(HistoryIpc.ReadPage, request),
    search: request => ipcRenderer.invoke(HistoryIpc.Search, request),
    rebuildIndex: () => ipcRenderer.invoke(HistoryIpc.RebuildIndex),
    selectMaintenance: request => ipcRenderer.invoke(HistoryIpc.SelectMaintenance, request),
    confirmMaintenance: request => ipcRenderer.invoke(HistoryIpc.ConfirmMaintenance, request),
    maintenanceStatus: () => ipcRenderer.invoke(HistoryIpc.MaintenanceStatus),
  } satisfies HistoryApi,

  codingAgent: {
    listProfiles: () => ipcRenderer.invoke(CodingAgentIpc.ListProfiles),
    listWorkspaces: () => ipcRenderer.invoke(CodingAgentIpc.ListWorkspaces),
    createWorkspace: (input: import('../shared/codingAgent').CreateCodingWorkspaceInput) =>
      ipcRenderer.invoke(CodingAgentIpc.CreateWorkspace, input),
    updateWorkspace: (input: import('../shared/codingAgent').UpdateCodingWorkspaceInput) =>
      ipcRenderer.invoke(CodingAgentIpc.UpdateWorkspace, input),
    deleteWorkspace: (workspaceId: string) =>
      ipcRenderer.invoke(CodingAgentIpc.DeleteWorkspace, workspaceId),
    deleteSession: (input: { workspaceRoot: string; laneId: string }) =>
      ipcRenderer.invoke(CodingAgentIpc.DeleteSession, input),
    getProfileConfigOptions: (profileId: string) =>
      ipcRenderer.invoke(CodingAgentIpc.GetProfileConfigOptions, profileId),
    getProfileAvailableCommands: (profileId: string) =>
      ipcRenderer.invoke(CodingAgentIpc.GetProfileAvailableCommands, profileId),
    createSession: (input: import('../shared/codingAgent').CreateCodingSessionInput) =>
      ipcRenderer.invoke(CodingAgentIpc.CreateSession, input),
    startSession: (input: import('../shared/codingAgent').StartCodingSessionInput) =>
      ipcRenderer.invoke(CodingAgentIpc.StartSession, input),
    bootstrap: (workspaceRoot: string) =>
      ipcRenderer.invoke(CodingAgentIpc.Bootstrap, workspaceRoot),
    loadEventPage: (input: {
      workspaceRoot: string;
      laneId: string;
      beforeSequence: number | null;
    }) => ipcRenderer.invoke(CodingAgentIpc.LoadEventPage, input),
    prepareLane: (input: { workspaceRoot: string; laneId: string }) =>
      ipcRenderer.invoke(CodingAgentIpc.PrepareLane, input),
    createMission: (input: import('../shared/codingAgent').CreateCodingMissionInput) =>
      ipcRenderer.invoke(CodingAgentIpc.CreateMission, input),
    selectLane: (input: { workspaceRoot: string; laneId: string }) =>
      ipcRenderer.invoke(CodingAgentIpc.SelectLane, input),
    prompt: (input: {
      workspaceRoot: string;
      prompt: import('../shared/codingAgent').CodingPromptInput;
    }) => ipcRenderer.invoke(CodingAgentIpc.Prompt, input),
    listPendingMessages: (laneId: string) =>
      ipcRenderer.invoke(CodingAgentIpc.ListPendingMessages, laneId),
    enqueuePendingMessage: (input: { laneId: string; text: string }) =>
      ipcRenderer.invoke(CodingAgentIpc.EnqueuePendingMessage, input),
    updatePendingMessage: (input: { laneId: string; itemId: string; text: string }) =>
      ipcRenderer.invoke(CodingAgentIpc.UpdatePendingMessage, input),
    deletePendingMessage: (input: { laneId: string; itemId: string }) =>
      ipcRenderer.invoke(CodingAgentIpc.DeletePendingMessage, input),
    steerPendingMessage: (input: { workspaceRoot: string; laneId: string; itemId: string }) =>
      ipcRenderer.invoke(CodingAgentIpc.SteerPendingMessage, input),
    followUpPendingMessage: (input: { workspaceRoot: string; laneId: string; itemId: string }) =>
      ipcRenderer.invoke(CodingAgentIpc.FollowUpPendingMessage, input),
    confirmSessionRecovery: (input: {
      workspaceRoot: string;
      laneId: string;
      includeRecoveryContext: boolean;
    }) => ipcRenderer.invoke(CodingAgentIpc.ConfirmSessionRecovery, input),
    cancel: (input: { workspaceRoot: string; laneId: string }) =>
      ipcRenderer.invoke(CodingAgentIpc.Cancel, input),
    respondElicitation: (input: {
      workspaceRoot: string;
      response: import('../shared/codingAgent').CodingElicitationResponse;
    }) => ipcRenderer.invoke(CodingAgentIpc.RespondElicitation, input),
    cancelElicitation: (input: { workspaceRoot: string; requestId: string }) =>
      ipcRenderer.invoke(CodingAgentIpc.CancelElicitation, input),
    previewHandoff: (input: {
      workspaceRoot: string;
      sourceLaneId: string;
      targetLaneId: string;
    }) => ipcRenderer.invoke(CodingAgentIpc.PreviewHandoff, input),
    handoff: (input: { workspaceRoot: string; sourceLaneId: string; targetLaneId: string }) =>
      ipcRenderer.invoke(CodingAgentIpc.Handoff, input),
    addLane: (input: { workspaceRoot: string; missionId: string; profileId: string }) =>
      ipcRenderer.invoke(CodingAgentIpc.AddLane, input),
    createCollaborationPreset: (
      input: import('../shared/codingAgent').CreateCodingCollaborationPresetInput,
    ) => ipcRenderer.invoke(CodingAgentIpc.CreateCollaborationPreset, input),
    saveLaneView: (input: {
      workspaceRoot: string;
      view: import('../shared/codingAgent').CodingLaneViewStateInput;
    }) => ipcRenderer.invoke(CodingAgentIpc.SaveLaneView, input),
    setLaneConfigOption: (input: {
      workspaceRoot: string;
      option: import('../shared/codingAgent').CodingLaneConfigOptionInput;
    }) => ipcRenderer.invoke(CodingAgentIpc.SetLaneConfigOption, input),
    setLaneModelOverride: (input: {
      workspaceRoot: string;
      laneId: string;
      modelOverride: string | null;
    }) => ipcRenderer.invoke(CodingAgentIpc.SetLaneModelOverride, input),
    previewLaneChanges: (input: { workspaceRoot: string; laneId: string }) =>
      ipcRenderer.invoke(CodingAgentIpc.PreviewLaneChanges, input),
    applyLaneChanges: (input: { workspaceRoot: string; laneId: string }) =>
      ipcRenderer.invoke(CodingAgentIpc.ApplyLaneChanges, input),
    getGitStatus: (input: import('../shared/codingAgent').CodingGitTargetInput) =>
      ipcRenderer.invoke(CodingAgentIpc.GetGitStatus, input),
    getGitDiff: (input: import('../shared/codingAgent').CodingGitDiffInput) =>
      ipcRenderer.invoke(CodingAgentIpc.GetGitDiff, input),
    stageGitPaths: (input: import('../shared/codingAgent').CodingGitPathActionInput) =>
      ipcRenderer.invoke(CodingAgentIpc.StageGitPaths, input),
    unstageGitPaths: (input: import('../shared/codingAgent').CodingGitPathActionInput) =>
      ipcRenderer.invoke(CodingAgentIpc.UnstageGitPaths, input),
    commitGitChanges: (input: import('../shared/codingAgent').CodingGitCommitInput) =>
      ipcRenderer.invoke(CodingAgentIpc.CommitGitChanges, input),
    commitAndPushGitChanges: (input: import('../shared/codingAgent').CodingGitCommitAndPushInput) =>
      ipcRenderer.invoke(CodingAgentIpc.CommitAndPushGitChanges, input),
    pushGitBranch: (input: import('../shared/codingAgent').CodingGitTargetInput) =>
      ipcRenderer.invoke(CodingAgentIpc.PushGitBranch, input),
    switchGitBranch: (input: import('../shared/codingAgent').CodingGitBranchInput) =>
      ipcRenderer.invoke(CodingAgentIpc.SwitchGitBranch, input),
    createGitBranch: (input: import('../shared/codingAgent').CodingGitBranchInput) =>
      ipcRenderer.invoke(CodingAgentIpc.CreateGitBranch, input),
    createGitPullRequest: (input: import('../shared/codingAgent').CodingGitPullRequestInput) =>
      ipcRenderer.invoke(CodingAgentIpc.CreateGitPullRequest, input),
    listWorkspaceFiles: (input: import('../shared/codingAgent').CodingWorkspaceFileInput) =>
      ipcRenderer.invoke(CodingAgentIpc.ListWorkspaceFiles, input),
    readWorkspaceFile: (input: import('../shared/codingAgent').CodingWorkspaceFileInput) =>
      ipcRenderer.invoke(CodingAgentIpc.ReadWorkspaceFile, input),
    writeWorkspaceFile: (input: import('../shared/codingAgent').CodingWorkspaceFileWriteInput) =>
      ipcRenderer.invoke(CodingAgentIpc.WriteWorkspaceFile, input),
    discoverAgents: (input: { workspaceRoot: string }) =>
      ipcRenderer.invoke(CodingAgentIpc.DiscoverAgents, input),
    probeAgent: (input: { workspaceRoot: string; profileId: string }) =>
      ipcRenderer.invoke(CodingAgentIpc.ProbeAgent, input),
    addProfile: (input: {
      workspaceRoot: string;
      profile: import('../shared/codingAgent').AddCodingAgentProfileInput;
    }) => ipcRenderer.invoke(CodingAgentIpc.AddProfile, input),
    trustProfile: (input: { workspaceRoot: string; profileId: string }) =>
      ipcRenderer.invoke(CodingAgentIpc.TrustProfile, input),
    authenticateProfile: (input: { workspaceRoot: string; profileId: string; methodId: string }) =>
      ipcRenderer.invoke(CodingAgentIpc.AuthenticateProfile, input),
    startAuthTerminal: (input: { workspaceRoot: string; profileId: string; methodId: string }) =>
      ipcRenderer.invoke(CodingAgentIpc.StartAuthTerminal, input),
    writeAuthTerminal: (input: { id: string; data: string }) =>
      ipcRenderer.invoke(CodingAgentIpc.WriteAuthTerminal, input),
    resizeAuthTerminal: (input: { id: string; columns: number; rows: number }) =>
      ipcRenderer.invoke(CodingAgentIpc.ResizeAuthTerminal, input),
    cancelAuthTerminal: (id: string) => ipcRenderer.invoke(CodingAgentIpc.CancelAuthTerminal, id),
    respondPermission: (input: {
      workspaceRoot: string;
      response: import('../shared/codingAgent').CodingPermissionResponse;
    }) => ipcRenderer.invoke(CodingAgentIpc.RespondPermission, input),
    onChanged: (callback: (snapshot: import('../shared/codingAgent').CodingRoomSnapshot) => void) =>
      onPush(CodingAgentIpc.Changed, callback),
    onEventDelta: (
      callback: (delta: import('../shared/codingAgent').CodingRoomEventDelta) => void,
    ) => onPush(CodingAgentIpc.EventDelta, callback),
    onPendingMessagesChanged: (
      callback: (event: import('../shared/codingAgent').CodingPendingMessagesChangedEvent) => void,
    ) => onPush(CodingAgentIpc.PendingMessagesChanged, callback),
    onAuthTerminalData: (callback: (event: { id: string; data: string }) => void) =>
      onPush(CodingAgentIpc.AuthTerminalData, callback),
    onAuthTerminalExit: (
      callback: (event: {
        id: string;
        profileId: string;
        methodId: string;
        exitCode: number;
        signal?: number;
      }) => void,
    ) => onPush(CodingAgentIpc.AuthTerminalExit, callback),
  },

  dialog: {
    selectDirectory: (options?: { defaultPath?: string }) =>
      ipcRenderer.invoke(DialogIpc.SelectDirectory, options),
    selectFile: (options?: {
      title?: string;
      filters?: { name: string; extensions: string[] }[];
    }) => ipcRenderer.invoke(DialogIpc.SelectFile, options),
    selectFiles: (options?: {
      title?: string;
      filters?: { name: string; extensions: string[] }[];
    }) => ipcRenderer.invoke(DialogIpc.SelectFiles, options),
    saveInlineFile: (options: {
      dataBase64: string;
      fileName?: string;
      mimeType?: string;
      cwd?: string;
    }) => ipcRenderer.invoke(DialogIpc.SaveInlineFile, options),
    readFileAsDataUrl: (filePath: string) =>
      ipcRenderer.invoke(DialogIpc.ReadFileAsDataUrl, filePath),
    checkArtifactFile: (filePath: string) =>
      ipcRenderer.invoke(DialogIpc.CheckArtifactFile, filePath),
    generateThumbnail: (filePath: string) =>
      ipcRenderer.invoke(DialogIpc.GenerateThumbnail, filePath),
    showMessageBox: (options: {
      message: string;
      type?: 'none' | 'info' | 'error' | 'question' | 'warning';
      title?: string;
    }) => ipcRenderer.invoke(DialogIpc.ShowMessageBox, options),
  },

  project: {
    getDefaultBaseDir: () => ipcRenderer.invoke(ProjectIpc.GetDefaultBaseDir),
    createDirectory: (options: { name: string; baseDir?: string }) =>
      ipcRenderer.invoke(ProjectIpc.CreateDirectory, options),
    ensureScratchDir: () => ipcRenderer.invoke(ProjectIpc.EnsureScratchDir),
    createRandomWorkspace: () => ipcRenderer.invoke(ProjectIpc.CreateRandomWorkspace),
  },

  shell: {
    openPath: (filePath: string) => ipcRenderer.invoke(ShellIpc.OpenPath, filePath),
    showItemInFolder: (filePath: string) => ipcRenderer.invoke(ShellIpc.ShowItemInFolder, filePath),
    openExternal: (url: string) => ipcRenderer.invoke(ShellIpc.OpenExternal, url),
    openHtmlInBrowser: (htmlContent: string) =>
      ipcRenderer.invoke(ShellIpc.OpenHtmlInBrowser, htmlContent),
    pathExists: (filePath: string) => ipcRenderer.invoke(ShellIpc.PathExists, filePath),
  },

  autoLaunch: {
    get: () => ipcRenderer.invoke(AppIpc.GetAutoLaunch),
    set: (enabled: boolean) => ipcRenderer.invoke(AppIpc.SetAutoLaunch, enabled),
  },

  preventSleep: {
    get: () => ipcRenderer.invoke(AppIpc.GetPreventSleep),
    set: (enabled: boolean) => ipcRenderer.invoke(AppIpc.SetPreventSleep, enabled),
  },

  appInfo: {
    getVersion: () => ipcRenderer.invoke(AppIpc.GetVersion),
    isDev: () => ipcRenderer.invoke(AppIpc.IsDev),
    isEnterprise: () => ipcRenderer.invoke(AppIpc.IsEnterprise),
    getSystemLocale: () => ipcRenderer.invoke(AppIpc.GetSystemLocale),
    consumePendingLocalInferenceInstall: () =>
      ipcRenderer.invoke(AppIpc.ConsumePendingLocalInferenceInstall),
    relaunch: () => ipcRenderer.invoke(AppIpc.Relaunch),
  },

  appUpdate: {
    getState: () => ipcRenderer.invoke(AppUpdateIpc.GetState),
    checkNow: (options?: { manual?: boolean; userId?: string | null }) =>
      ipcRenderer.invoke(AppUpdateIpc.CheckNow, options),
    retryDownload: () => ipcRenderer.invoke(AppUpdateIpc.RetryDownload),
    pauseDownload: () => ipcRenderer.invoke(AppUpdateIpc.PauseDownload),
    resumeDownload: () => ipcRenderer.invoke(AppUpdateIpc.ResumeDownload),
    cancelDownload: () => ipcRenderer.invoke(AppUpdateIpc.CancelDownload),
    installReady: () => ipcRenderer.invoke(AppUpdateIpc.InstallReady),
    revealDownload: () => ipcRenderer.invoke(AppUpdateIpc.RevealDownload),
    onStateChanged: (callback: (data: unknown) => void) =>
      onPush(AppUpdateIpc.StateChanged, callback),
  },

  log: {
    getPath: () => ipcRenderer.invoke(LogIpc.GetPath),
    openFolder: () => ipcRenderer.invoke(LogIpc.OpenFolder),
    exportZip: () => ipcRenderer.invoke(LogIpc.ExportZip),
    fromRenderer: (level: string, tag: string, message: string) =>
      ipcRenderer.send(LogIpc.FromRenderer, level, tag, message),
  },

  runtimeNotices: {
    onNotice: (callback: (notice: import('../common/runtimeNotice').RuntimeRetryNotice) => void) =>
      onPush(RuntimeNoticeIpc.Notice, callback),
  },

  scheduledTasks: {
    list: () => ipcRenderer.invoke(ScheduledTaskIpc.List),
    get: (id: string) => ipcRenderer.invoke(ScheduledTaskIpc.Get, id),
    create: (input: unknown) => ipcRenderer.invoke(ScheduledTaskIpc.Create, input),
    update: (id: string, input: unknown) => ipcRenderer.invoke(ScheduledTaskIpc.Update, id, input),
    delete: (id: string) => ipcRenderer.invoke(ScheduledTaskIpc.Delete, id),
    toggle: (id: string, enabled: boolean) =>
      ipcRenderer.invoke(ScheduledTaskIpc.Toggle, id, enabled),

    runManually: (id: string) => ipcRenderer.invoke(ScheduledTaskIpc.RunManually, id),
    stop: (id: string) => ipcRenderer.invoke(ScheduledTaskIpc.Stop, id),

    listRuns: (taskId: string, limit?: number, offset?: number, filter?: unknown) =>
      ipcRenderer.invoke(ScheduledTaskIpc.ListRuns, taskId, limit, offset, filter),
    countRuns: (taskId: string) => ipcRenderer.invoke(ScheduledTaskIpc.CountRuns, taskId),
    listAllRuns: (limit?: number, offset?: number, filter?: unknown) =>
      ipcRenderer.invoke(ScheduledTaskIpc.ListAllRuns, limit, offset, filter),
    resolveSession: (sessionKey: string) =>
      ipcRenderer.invoke(ScheduledTaskIpc.ResolveSession, sessionKey),

    onStatusUpdate: (callback: (data: unknown) => void) =>
      onPush(ScheduledTaskIpc.StatusUpdate, callback),
    onRunUpdate: (callback: (data: unknown) => void) =>
      onPush(ScheduledTaskIpc.RunUpdate, callback),
    onRefresh: (callback: () => void) => onPushVoid(ScheduledTaskIpc.Refresh, callback),
  },

  networkStatus: {
    send: (status: 'online' | 'offline') => ipcRenderer.send(NetworkIpc.StatusChange, status),
  },

  // 2026/09/17 lixiang  开发态主进程网络日志 → 渲染进程 Network beacon
  devNetwork: {
    onEntry: (callback: (entry: import('../shared/devNetworkLog').DevNetworkLogEntry) => void) =>
      onPush(DevNetworkIpc.Entry, callback),
  },

  auth: {
    communityLogin: () => ipcRenderer.invoke(CommunityAuthIpc.Login),
    getCommunityUser: () => ipcRenderer.invoke(CommunityAuthIpc.GetCommunityUser),
    communityLogout: () => ipcRenderer.invoke(CommunityAuthIpc.Logout),
    onCommunityCallback: (
      callback: (data: {
        success: boolean;
        user?: { id: string; email: string; name: string };
        error?: string;
      }) => void,
    ) => onPush(CommunityAuthIpc.Callback, callback),
  },

  modelPool: {
    listModels: () => ipcRenderer.invoke(ModelPoolIpc.ListModels),
    stream: (input: { requestId: string; conversationId: string; body: Record<string, unknown> }) =>
      ipcRenderer.invoke(ModelPoolIpc.Stream, input),
    cancelStream: (requestId: string) => ipcRenderer.invoke(ModelPoolIpc.CancelStream, requestId),
    onStreamData: (requestId: string, callback: (data: string) => void) =>
      onPush(ModelPoolIpc.streamData(requestId), callback),
    onStreamDone: (requestId: string, callback: () => void) =>
      onPushVoid(ModelPoolIpc.streamDone(requestId), callback),
    onStreamError: (requestId: string, callback: (error: string) => void) =>
      onPush(ModelPoolIpc.streamError(requestId), callback),
    onStreamAbort: (requestId: string, callback: () => void) =>
      onPushVoid(ModelPoolIpc.streamAbort(requestId), callback),
  },

  activity: {
    list: () => ipcRenderer.invoke(ActivityIpc.List),
    onUpdated: (callback: (run: ActivityRun) => void) => onPush(ActivityIpc.Updated, callback),
  },
});
