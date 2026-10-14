import type { PiUiRuntimeSnapshot } from '../../shared/cowork/piUiRuntimeSnapshot';
import type { AppUpdateCheckResult, AppUpdateRuntimeState } from '../../shared/appUpdate/constants';
import type { CoworkError } from '../../common/coworkError';
import type { RuntimeRetryNotice } from '../../common/runtimeNotice';
import type { ActivityRun } from '../../shared/activity/types';
import type { ContextMenuAction, ContextMenuOpenEvent } from '../../shared/contextMenu';
import type { NvidiaSmiSnapshot, SystemMemorySnapshot } from '../../shared/hardware';
import type {
  CoworkExecutionMode,
  CoworkPermissionMode,
  CoworkSessionMode,
  CoworkSessionSource,
} from '../../shared/cowork/constants';
import type { CoworkPendingMessage } from '../../shared/cowork/pendingMessageQueue';
import type {
  ProviderModelDiscoveryRequest,
  ProviderModelDiscoveryResult,
} from '../../shared/providers';
import type {
  LlamaCppCancelModelLoadResult,
  LlamaCppCancelInstallResult,
  LlamaCppGatewayLanTokenResult,
  LlamaCppImportModelFilesResult,
  LlamaCppInstallModelInput,
  LlamaCppInstallProgress,
  LlamaCppLatestModelLaunchLogSessionInput,
  LlamaCppModel,
  LlamaCppModelLaunchInput,
  LlamaCppModelLaunchLogClearedEvent,
  LlamaCppModelLaunchLogEvent,
  LlamaCppModelLaunchLogSession,
  LlamaCppModelLaunchLogWindowTarget,
  LlamaCppModelLaunchResult,
  LlamaCppModelPreferences,
  LlamaCppModelUnloadResult,
  LlamaCppOpenModelLaunchLogWindowInput,
  LlamaCppOpenModelLaunchLogWindowResult,
  LlamaCppReadModelLaunchLogFileInput,
  LlamaCppReadModelLaunchLogFileResult,
  LlamaCppRunningModel,
  LlamaCppRuntimeCapabilities,
  LlamaCppRuntimeImportResult,
  LlamaCppRuntimeInstallResult,
  LlamaCppRuntimeListDevicesResult,
  LlamaCppRuntimeUninstallResult,
  LlamaCppServiceConfig,
  LlamaCppSetModelPreferenceInput,
  LlamaCppStatusSnapshot,
} from '../../shared/llamacpp';
import type {
  MarketplaceSearchRequest,
  MarketplaceSearchParams,
  MarketplaceSearchResult,
} from '../../shared/marketplace';
import type {
  WorkbenchApprovalResponseInput,
  WorkbenchTaskActionResult,
  WorkbenchTaskChangedEvent,
  WorkbenchTaskExportResult,
  WorkbenchTaskListResult,
} from '../../shared/workbenchTask';
import type {
  OllamaCancelPullResult,
  OllamaChatChunk,
  OllamaChatPayload,
  OllamaInstallProgress,
  OllamaModel,
  OllamaModelLaunchInput,
  OllamaModelLaunchResult,
  OllamaRunningModel,
  OllamaServiceConfig,
  OllamaStatusSnapshot,
} from '../../shared/ollama';
import type { TriageConfig } from '../../shared/triage';
import type { CodingAgentProfile, CodingRoomSnapshot } from '../../shared/codingAgent';

interface CodingAgentActionResult {
  success: boolean;
  error?: string;
  conflict?: boolean;
  snapshot?: CodingRoomSnapshot;
  /** Profiles for manager actions that run before a workspace is open. */
  profiles?: CodingAgentProfile[];
}

interface CodingHandoffPreviewResult {
  success: boolean;
  content?: Record<string, unknown>;
  error?: string;
}

interface CodingLaneChangePreviewResult {
  success: boolean;
  preview?: import('../../shared/codingAgent').CodingLaneChangePreview;
  error?: string;
}
interface CodingGitStatusResult {
  success: boolean;
  status?: import('../../shared/codingAgent').CodingGitStatus;
  error?: string;
}
interface CodingGitCommitAndPushActionResult {
  success: boolean;
  result?: import('../../shared/codingAgent').CodingGitCommitAndPushResult;
  error?: string;
}
interface CodingGitDiffResult {
  success: boolean;
  diff?: string;
  error?: string;
}
interface CodingWorkspaceActionResult {
  success: boolean;
  workspaces?: import('../../shared/codingAgent').CodingWorkspaceSummary[];
  error?: string;
}
interface CodingAgentProfilesResult {
  success: boolean;
  profiles?: import('../../shared/codingAgent').CodingAgentProfile[];
  error?: string;
}
interface CodingAgentConfigOptionsResult {
  success: boolean;
  configOptions?: import('../../shared/codingAgent').CodingAgentConfigOption[];
  error?: string;
}
interface CodingAgentCommandsResult {
  success: boolean;
  commands?: import('../../shared/codingAgent').CodingAgentAvailableCommand[];
  error?: string;
}
interface ApiResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  data: any;
  error?: string;
}

// Cowork types for IPC
interface CoworkSession {
  mode?: import('../../shared/cowork/constants').CoworkSessionMode;
  id: string;
  title: string;
  status: 'idle' | 'running' | 'completed' | 'error';
  pinned: boolean;
  pinOrder?: number | null;
  cwd: string;
  systemPrompt: string;
  modelOverride: string;
  executionMode: CoworkExecutionMode;
  activeSkillIds: string[];
  workspaceId: string;
  agentId: string;
  source: CoworkSessionSource;
  messages: CoworkMessage[];
  messagesOffset: number;
  totalMessages: number;
  createdAt: number;
  updatedAt: number;
}

interface CoworkMessage {
  id: string;
  type: 'user' | 'assistant' | 'tool_use' | 'tool_result' | 'system';
  content: string;
  timestamp: number;
  sequence?: number;
  metadata?: Record<string, unknown>;
}

interface CoworkSessionSummary {
  id: string;
  title: string;
  status: 'idle' | 'running' | 'completed' | 'error';
  pinned: boolean;
  pinOrder?: number | null;
  workspaceId?: string;
  agentId?: string;
  source: CoworkSessionSource;
  createdAt: number;
  updatedAt: number;
}

interface CoworkConfig {
  workingDirectory: string;
  systemPrompt: string;
  executionMode: CoworkExecutionMode;
  permissionMode: CoworkPermissionMode;
  embeddingEnabled: boolean;
  embeddingProvider: string;
  embeddingModel: string;
  embeddingLocalModelPath: string;
  embeddingVectorWeight: number;
  embeddingRemoteBaseUrl: string;
  embeddingRemoteApiKey: string;
}

type CoworkConfigUpdate = Partial<
  Pick<
    CoworkConfig,
    | 'workingDirectory'
    | 'executionMode'
    | 'permissionMode'
    | 'embeddingEnabled'
    | 'embeddingProvider'
    | 'embeddingModel'
    | 'embeddingLocalModelPath'
    | 'embeddingVectorWeight'
    | 'embeddingRemoteBaseUrl'
    | 'embeddingRemoteApiKey'
  >
>;

interface CoworkApiConfig {
  apiKey: string;
  baseURL: string;
  model: string;
  apiType?: 'anthropic' | 'openai';
}

interface WindowState {
  isMaximized: boolean;
  isFullscreen: boolean;
  isFocused: boolean;
}

interface IElectronAPI {
  platform: string;
  arch: string;
  store: {
    get: (key: string) => Promise<any>;
    set: (key: string, value: any) => Promise<void>;
    remove: (key: string) => Promise<void>;
  };
  ollama: {
    status: () => Promise<OllamaStatusSnapshot>;
    install: () => Promise<OllamaStatusSnapshot>;
    start: () => Promise<OllamaStatusSnapshot>;
    stop: () => Promise<OllamaStatusSnapshot>;
    restart: () => Promise<OllamaStatusSnapshot>;
    getServiceConfig: () => Promise<OllamaServiceConfig>;
    setServiceConfig: (config: OllamaServiceConfig) => Promise<OllamaServiceConfig>;
    modelsDir: () => Promise<string>;
    listLocalModels: () => Promise<OllamaModel[]>;
    listRunningModels: () => Promise<OllamaRunningModel[]>;
    deleteModel: (name: string) => Promise<{ success: boolean }>;
    showModel: (name: string) => Promise<unknown>;
    createModel: (name: string, modelfile: string) => Promise<{ success: boolean }>;
    preloadModel: (input: OllamaModelLaunchInput) => Promise<OllamaModelLaunchResult>;
    unloadModel: (name: string) => Promise<OllamaModelLaunchResult>;
    pullModel: (name: string) => Promise<{ success: boolean }>;
    cancelPull: (name: string) => Promise<OllamaCancelPullResult>;
    chat: (payload: OllamaChatPayload) => Promise<OllamaChatChunk>;
    chatStream: (requestId: string, payload: OllamaChatPayload) => Promise<{ success: boolean }>;
    cancelChatStream: (requestId: string) => Promise<{ success: boolean; cancelled: boolean }>;
    onStatusChanged: (callback: (snapshot: OllamaStatusSnapshot) => void) => () => void;
    onInstallProgress: (callback: (progress: OllamaInstallProgress) => void) => () => void;
    onPullProgress: (
      callback: (payload: { name: string; chunk: Record<string, unknown> }) => void,
    ) => () => void;
    onChatStreamChunk: (
      callback: (payload: { requestId: string; chunk: OllamaChatChunk }) => void,
    ) => () => void;
  };
  llamacpp: {
    status: () => Promise<LlamaCppStatusSnapshot>;
    install: () => Promise<LlamaCppRuntimeInstallResult>;
    cancelRuntimeInstall: () => Promise<LlamaCppCancelInstallResult>;
    importRuntime: () => Promise<LlamaCppRuntimeImportResult>;
    fetchWindowsRuntimeManifest: (url: string) => Promise<unknown | null>;
    listRuntimeDevices: (
      input?: import('../../shared/llamacpp').LlamaCppBackendRef,
    ) => Promise<LlamaCppRuntimeListDevicesResult>;
    getRuntimeCapabilities: () => Promise<LlamaCppRuntimeCapabilities>;
    listBackends: () => Promise<import('../../shared/llamacpp').LlamaCppBackendListResult>;
    getBackendDownloadSize: (
      input: import('../../shared/llamacpp').LlamaCppBackendRef,
    ) => Promise<import('../../shared/llamacpp').LlamaCppBackendDownloadSizeResult>;
    getBackendSelection: () => Promise<
      import('../../shared/llamacpp').LlamaCppBackendRef | undefined
    >;
    setBackendSelection: (
      input: import('../../shared/llamacpp').LlamaCppBackendRef,
    ) => Promise<LlamaCppRuntimeInstallResult>;
    installBackend: (
      input?: import('../../shared/llamacpp').LlamaCppBackendRef,
    ) => Promise<LlamaCppRuntimeInstallResult>;
    getRuntimeInstallSnapshot: () => Promise<
      import('../../shared/llamacpp').LlamaCppRuntimeInstallSnapshot
    >;
    uninstallBackend: (
      input?: import('../../shared/llamacpp').LlamaCppBackendRef,
    ) => Promise<LlamaCppRuntimeUninstallResult>;
    uninstallRuntime: () => Promise<LlamaCppRuntimeUninstallResult>;
    start: () => Promise<LlamaCppStatusSnapshot>;
    stop: () => Promise<LlamaCppStatusSnapshot>;
    restart: () => Promise<LlamaCppStatusSnapshot>;
    getServiceConfig: () => Promise<LlamaCppServiceConfig>;
    setServiceConfig: (config: LlamaCppServiceConfig) => Promise<LlamaCppServiceConfig>;
    getGatewayLanToken: () => Promise<LlamaCppGatewayLanTokenResult>;
    regenerateGatewayLanToken: () => Promise<LlamaCppGatewayLanTokenResult>;
    modelsDir: () => Promise<string>;
    setModelsDir: (modelsDir: string) => Promise<string>;
    listLocalModels: () => Promise<LlamaCppModel[]>;
    listRunningModels: () => Promise<LlamaCppRunningModel[]>;
    refreshRunningModelBindings: () => Promise<void>;
    importModelFiles: (paths: string[]) => Promise<LlamaCppImportModelFilesResult>;
    deleteModel: (name: string) => Promise<{
      success: boolean;
      deleted?: boolean;
      reason?: 'not-local-file' | 'not-app-managed';
      error?: string;
      removedModelName?: string;
      clearedDefaultModel?: boolean;
    }>;
    showModel: (name: string) => Promise<unknown>;
    getModelPreferences: () => Promise<LlamaCppModelPreferences>;
    setModelPreference: (
      input: LlamaCppSetModelPreferenceInput,
    ) => Promise<LlamaCppModelPreferences>;
    loadModel: (input: LlamaCppModelLaunchInput) => Promise<LlamaCppModelLaunchResult>;
    cancelModelLoad: (modelName?: string) => Promise<LlamaCppCancelModelLoadResult>;
    unloadModel: (name: string) => Promise<LlamaCppModelUnloadResult>;
    getLatestModelLaunchLogSession: (
      input?: LlamaCppLatestModelLaunchLogSessionInput,
    ) => Promise<LlamaCppModelLaunchLogSession | null>;
    readModelLaunchLogFile: (
      input: LlamaCppReadModelLaunchLogFileInput,
    ) => Promise<LlamaCppReadModelLaunchLogFileResult>;
    openModelLaunchLogWindow: (
      input?: LlamaCppOpenModelLaunchLogWindowInput,
    ) => Promise<LlamaCppOpenModelLaunchLogWindowResult>;
    installModel: (
      input: LlamaCppInstallModelInput,
    ) => Promise<{ success: boolean; cancelled?: boolean }>;
    cancelInstall: (modelId: string) => Promise<LlamaCppCancelInstallResult>;
    onStatusChanged: (callback: (snapshot: LlamaCppStatusSnapshot) => void) => () => void;
    onModelBindingsChanged: (callback: () => void) => () => void;
    onInstallProgress: (callback: (progress: LlamaCppInstallProgress) => void) => () => void;
    onModelLaunchLog: (callback: (event: LlamaCppModelLaunchLogEvent) => void) => () => void;
    onModelLaunchLogCleared: (
      callback: (event: LlamaCppModelLaunchLogClearedEvent) => void,
    ) => () => void;
    onModelLaunchLogWindowTargetChanged: (
      callback: (target: LlamaCppModelLaunchLogWindowTarget) => void,
    ) => () => void;
    onPullProgress: (
      callback: (payload: { name: string; chunk: Record<string, unknown> }) => void,
    ) => () => void;
  };
  marketplace: {
    search: (request: MarketplaceSearchRequest) => Promise<MarketplaceSearchResult>;
    cancelSearch: (requestId: string) => Promise<{ cancelled: boolean }>;
  };
  triage: {
    getConfig: () => Promise<TriageConfig>;
    setConfig: (config: TriageConfig) => Promise<TriageConfig>;
  };
  hardware: {
    nvidiaSmi: () => Promise<NvidiaSmiSnapshot>;
    systemMemory: () => Promise<SystemMemorySnapshot>;
  };
  agents: {
    list: () => Promise<Agent[]>;
    get: (id: string) => Promise<Agent | null>;
    create: (request: {
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
    }) => Promise<Agent>;
    update: (
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
        triageOverride?: import('../../shared/triage').AgentTriageOverride | null;
      },
    ) => Promise<Agent>;
    delete: (id: string) => Promise<boolean>;
    importExpertPackage: (expertDir: string) => Promise<{
      success: boolean;
      agentIds?: string[];
      expertType?: string;
      name?: string;
      error?: string;
    }>;
    getPresetExperts: () => Promise<{
      experts: Array<{
        name: string;
        displayName: { en: string; zh: string };
        profession: { en: string; zh: string };
        displayDescription: { en: string; zh: string };
        categoryId: string;
        tags: Array<{ en: string; zh: string }>;
        quickPrompts: Array<{ en: string; zh: string }>;
        workflow: string[];
        path: string;
      }>;
      error?: string;
    }>;
  };
  api: {
    fetch: (options: {
      url: string;
      method: string;
      headers: Record<string, string>;
      body?: string;
      timeoutMs?: number;
      purpose?: import('../../shared/ipc/apiRequest').ApiRequestPurpose;
    }) => Promise<ApiResponse>;
    fetchModels: (input: ProviderModelDiscoveryRequest) => Promise<ProviderModelDiscoveryResult>;
  };
  getApiConfig: () => Promise<CoworkApiConfig | null>;
  checkApiConfig: (options?: {
    probeModel?: boolean;
  }) => Promise<{ hasConfig: boolean; config: CoworkApiConfig | null; error?: string }>;
  saveApiConfig: (config: CoworkApiConfig) => Promise<{ success: boolean; error?: string }>;
  generateSessionTitle: (userInput: string | null) => Promise<string>;
  getRecentCwds: (limit?: number) => Promise<string[]>;
  appEvents: {
    onOpenSettings: (callback: () => void) => () => void;
    onNewTask: (callback: () => void) => () => void;
  };
  contextMenu: {
    execute: (action: ContextMenuAction) => void;
    onOpen: (callback: (event: ContextMenuOpenEvent) => void) => () => void;
  };
  window: {
    minimize: () => void;
    toggleMaximize: () => void;
    close: () => void;
    isMaximized: () => Promise<boolean>;
    showSystemMenu: (position: { x: number; y: number }) => void;
    toggleDevTools: () => Promise<boolean>;
    openDevTools: () => Promise<boolean>;
    onStateChanged: (callback: (state: WindowState) => void) => () => void;
  };
  cowork: {
    getWorkDocument: (
      sessionId: string,
    ) => Promise<import('../../shared/durable/workDocument').WorkDocumentResult>;
    updateWorkDocument: (
      sessionId: string,
      patch: import('../../shared/durable/workDocument').WorkDocumentPatch,
    ) => Promise<import('../../shared/durable/workDocument').WorkDocumentResult>;
    onWorkDocumentChanged: (
      callback: (change: import('../../shared/durable/workDocument').WorkDocumentChanged) => void,
    ) => () => void;
    getDurableWork: (sessionId: string) => Promise<{
      success: boolean;
      snapshot?: import('../../shared/durable/types').DurableWorkSnapshot;
      error?: string;
    }>;
    resumeDurableWork: (sessionId: string) => Promise<{ success: boolean; error?: string }>;
    getRunSnapshot: (
      sessionId: string,
      replayContent?: boolean,
    ) => Promise<{
      success: boolean;
      snapshot: import('../../shared/cowork/runState').CoworkRunSnapshot | null;
      running: boolean;
    }>;
    onStreamRunState: (
      callback: (snapshot: import('../../shared/cowork/runState').CoworkRunSnapshot) => void,
    ) => () => void;
    onStreamContentPatch: (
      callback: (patch: import('../../shared/cowork/runState').CoworkContentPatch) => void,
    ) => () => void;
    listWorkspaces: () => Promise<{
      success: boolean;
      workspaces?: import('../../shared/workspace').Workspace[];
      error?: string;
    }>;
    createWorkspace: (options: { path: string; name: string }) => Promise<{
      success: boolean;
      workspace?: import('../../shared/workspace').Workspace;
      error?: string;
    }>;
    ensureWorkspace: (options: { path: string; name?: string; isHidden?: boolean }) => Promise<{
      success: boolean;
      workspace?: import('../../shared/workspace').Workspace;
      error?: string;
    }>;
    renameWorkspace: (
      id: string,
      name: string,
    ) => Promise<{
      success: boolean;
      workspace?: import('../../shared/workspace').Workspace;
      error?: string;
    }>;
    updateWorkspace: (options: {
      id: string;
      name?: string;
      primaryPath?: string;
      folders?: string[];
    }) => Promise<{
      success: boolean;
      workspace?: import('../../shared/workspace').Workspace;
      error?: string;
    }>;
    deleteWorkspace: (id: string) => Promise<{
      success: boolean;
      deletedSessionIds?: string[];
      error?: string;
    }>;
    startSession: (options: {
      requestId?: string;
      prompt: string;
      cwd?: string;
      systemPrompt?: string;
      title?: string;
      activeSkillIds?: string[];
      goalMode?: boolean;
      workspaceId?: string;
      agentId?: string;
      expertIds?: string[];
      permissionMode?: CoworkPermissionMode;
      permissionModeBySession?: Record<string, CoworkPermissionMode>;
      imageAttachments?: Array<{
        name: string;
        mimeType: string;
        base64Data?: string;
        path?: string;
      }>;
      fileAttachments?: Array<{ name: string; path: string; extension: string; isImage?: boolean }>;
    }) => Promise<{
      success: boolean;
      session?: CoworkSession;
      error?: string;
      code?: string;
    }>;
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
    }) => Promise<{
      success: boolean;
      session?: CoworkSession;
      error?: string;
      code?: string;
    }>;
    listPendingMessages: (
      sessionId: string,
    ) => Promise<{ success: boolean; items?: CoworkPendingMessage[]; error?: string }>;
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
    }) => Promise<{ success: boolean; item?: CoworkPendingMessage; error?: string }>;
    updatePendingMessage: (options: {
      sessionId: string;
      itemId: string;
      text: string;
    }) => Promise<{ success: boolean; item?: CoworkPendingMessage; error?: string }>;
    deletePendingMessage: (options: {
      sessionId: string;
      itemId: string;
    }) => Promise<{ success: boolean; error?: string }>;
    steerPendingMessage: (options: {
      sessionId: string;
      itemId: string;
    }) => Promise<{ success: boolean; item?: CoworkPendingMessage; error?: string }>;
    followUpPendingMessage: (options: {
      sessionId: string;
      itemId: string;
    }) => Promise<{ success: boolean; item?: CoworkPendingMessage; error?: string }>;
    stopSession: (sessionId: string) => Promise<{ success: boolean; error?: string }>;
    compactSession: (
      sessionId: string,
    ) => Promise<import('../../shared/cowork/constants').CoworkCompactResult>;
    saveSession: (session: Record<string, unknown>) => Promise<CoworkSessionResult>;
    deleteSession: (sessionId: string) => Promise<{ success: boolean; error?: string }>;
    deleteSessions: (sessionIds: string[]) => Promise<{ success: boolean; error?: string }>;
    setSessionPinned: (options: {
      sessionId: string;
      pinned: boolean;
    }) => Promise<{ success: boolean; pinOrder?: number | null; error?: string }>;
    renameSession: (options: {
      sessionId: string;
      title: string;
    }) => Promise<{ success: boolean; title?: string; error?: string }>;
    updateSessionModel: (options: {
      sessionId: string;
      modelOverride: string;
    }) => Promise<{ success: boolean; session?: CoworkSession | null; error?: string }>;
    getSession: (
      sessionId: string,
      options?: { messageLimit?: number | null },
    ) => Promise<{ success: boolean; session?: CoworkSession; error?: string }>;
    getRuntimeSnapshots: (sessionId?: string) => Promise<PiUiRuntimeSnapshot[]>;
    listSessions: (options?: {
      limit?: number;
      offset?: number;
      agentId?: string;
      workspaceId?: string;
      mode?: CoworkSessionMode;
      sources?: CoworkSessionSource[];
    }) => Promise<{
      success: boolean;
      sessions?: CoworkSessionSummary[];
      hasMore?: boolean;
      error?: string;
    }>;
    getSessionMessages: (options: {
      sessionId: string;
      limit?: number;
      offset?: number;
    }) => Promise<{
      success: boolean;
      messages?: CoworkMessage[];
      offset?: number;
      total?: number;
      error?: string;
    }>;
    exportResultImage: (options: {
      rect: { x: number; y: number; width: number; height: number };
      defaultFileName?: string;
    }) => Promise<{ success: boolean; canceled?: boolean; path?: string; error?: string }>;
    captureImageChunk: (options: {
      rect: { x: number; y: number; width: number; height: number };
    }) => Promise<{
      success: boolean;
      width?: number;
      height?: number;
      pngBase64?: string;
      error?: string;
    }>;
    saveResultImage: (options: {
      pngBase64: string;
      defaultFileName?: string;
    }) => Promise<{ success: boolean; canceled?: boolean; path?: string; error?: string }>;
    exportSessionText: (options: {
      content: string;
      defaultFileName?: string;
      fileExtension?: string;
    }) => Promise<{ success: boolean; canceled?: boolean; path?: string; error?: string }>;
    respondToPermission: (options: {
      requestId: string;
      result: CoworkPermissionResult;
    }) => Promise<{ success: boolean; error?: string }>;
    getConfig: () => Promise<{ success: boolean; config?: CoworkConfig; error?: string }>;
    setConfig: (config: CoworkConfigUpdate) => Promise<{ success: boolean; error?: string }>;
    onStreamUiEvent: (
      callback: (event: import('../../shared/cowork/piUiEvent').PiUiEvent) => void,
    ) => () => void;
    onSessionsChanged: (
      callback: (data: {
        sessionId?: string;
        deletedSessionIds?: string[];
        agentId?: string;
      }) => void,
    ) => () => void;
  };
  workbenchTask: {
    getCurrent: (sessionId: string) => Promise<WorkbenchTaskActionResult>;
    getDetail: (taskId: string) => Promise<WorkbenchTaskActionResult>;
    listForSession: (sessionId: string) => Promise<WorkbenchTaskListResult>;
    exportAudit: (taskId: string) => Promise<WorkbenchTaskExportResult>;
    accept: (taskId: string) => Promise<WorkbenchTaskActionResult>;
    respondToApproval: (
      input: WorkbenchApprovalResponseInput,
    ) => Promise<WorkbenchTaskActionResult>;
    onChanged: (callback: (event: WorkbenchTaskChangedEvent) => void) => () => void;
  };
  todo: {
    list: (
      input: import('../../shared/todo').TodoListInput,
    ) => Promise<import('../../shared/todo').TodoListResult>;
    create: (
      input: import('../../shared/todo').TodoCreateInput,
    ) => Promise<import('../../shared/todo').TodoActionResult>;
    update: (
      input: import('../../shared/todo').TodoUpdateInput & { todoId: string },
    ) => Promise<import('../../shared/todo').TodoActionResult>;
    delete: (todoId: string) => Promise<{ success: boolean; error?: string }>;
    listLists: () => Promise<import('../../shared/todo').TodoListsResult>;
    createList: (
      input: import('../../shared/todo').TodoListCreateInput,
    ) => Promise<import('../../shared/todo').TodoListActionResult>;
    updateList: (
      input: import('../../shared/todo').TodoListUpdateInput & { listId: string },
    ) => Promise<import('../../shared/todo').TodoListActionResult>;
    deleteList: (listId: string) => Promise<{ success: boolean; error?: string }>;
    createStep: (
      input: import('../../shared/todo').TodoStepCreateInput,
    ) => Promise<import('../../shared/todo').TodoStepActionResult>;
    updateStep: (
      input: import('../../shared/todo').TodoStepUpdateInput,
    ) => Promise<import('../../shared/todo').TodoStepActionResult>;
    deleteStep: (stepId: string) => Promise<{ success: boolean; error?: string }>;
    onChanged: (
      callback: (event: import('../../shared/todo').TodoChangedEvent) => void,
    ) => () => void;
  };
  codingAgent: {
    listProfiles: () => Promise<CodingAgentProfilesResult>;
    listWorkspaces: () => Promise<CodingWorkspaceActionResult>;
    createWorkspace: (
      input: import('../../shared/codingAgent').CreateCodingWorkspaceInput,
    ) => Promise<CodingWorkspaceActionResult>;
    updateWorkspace: (
      input: import('../../shared/codingAgent').UpdateCodingWorkspaceInput,
    ) => Promise<CodingWorkspaceActionResult>;
    deleteWorkspace: (workspaceId: string) => Promise<CodingWorkspaceActionResult>;
    deleteSession: (input: {
      workspaceRoot: string;
      laneId: string;
    }) => Promise<CodingWorkspaceActionResult>;
    getProfileConfigOptions: (profileId: string) => Promise<CodingAgentConfigOptionsResult>;
    getProfileAvailableCommands: (profileId: string) => Promise<CodingAgentCommandsResult>;
    createSession: (
      input: import('../../shared/codingAgent').CreateCodingSessionInput,
    ) => Promise<CodingAgentActionResult>;
    startSession: (
      input: import('../../shared/codingAgent').StartCodingSessionInput,
    ) => Promise<CodingAgentActionResult>;
    bootstrap: (workspaceRoot: string) => Promise<CodingAgentActionResult>;
    prepareLane: (input: {
      workspaceRoot: string;
      laneId: string;
    }) => Promise<CodingAgentActionResult>;
    createMission: (
      input: import('../../shared/codingAgent').CreateCodingMissionInput,
    ) => Promise<CodingAgentActionResult>;
    selectLane: (input: {
      workspaceRoot: string;
      laneId: string;
    }) => Promise<CodingAgentActionResult>;
    prompt: (input: {
      workspaceRoot: string;
      prompt: import('../../shared/codingAgent').CodingPromptInput;
    }) => Promise<CodingAgentActionResult>;
    listPendingMessages: (laneId: string) => Promise<{
      success: boolean;
      items?: import('../../shared/cowork/pendingMessageQueue').CoworkPendingMessage[];
      error?: string;
    }>;
    enqueuePendingMessage: (input: { laneId: string; text: string }) => Promise<{
      success: boolean;
      item?: import('../../shared/cowork/pendingMessageQueue').CoworkPendingMessage;
      error?: string;
    }>;
    updatePendingMessage: (input: {
      laneId: string;
      itemId: string;
      text: string;
    }) => Promise<{ success: boolean; error?: string }>;
    deletePendingMessage: (input: {
      laneId: string;
      itemId: string;
    }) => Promise<{ success: boolean; error?: string }>;
    steerPendingMessage: (input: {
      workspaceRoot: string;
      laneId: string;
      itemId: string;
    }) => Promise<CodingAgentActionResult>;
    followUpPendingMessage: (input: {
      workspaceRoot: string;
      laneId: string;
      itemId: string;
    }) => Promise<CodingAgentActionResult>;
    confirmSessionRecovery: (input: {
      workspaceRoot: string;
      laneId: string;
      includeRecoveryContext: boolean;
    }) => Promise<CodingAgentActionResult>;
    cancel: (input: { workspaceRoot: string; laneId: string }) => Promise<CodingAgentActionResult>;
    respondElicitation: (input: {
      workspaceRoot: string;
      response: import('../../shared/codingAgent').CodingElicitationResponse;
    }) => Promise<CodingAgentActionResult>;
    cancelElicitation: (input: {
      workspaceRoot: string;
      requestId: string;
    }) => Promise<CodingAgentActionResult>;
    previewHandoff: (input: {
      workspaceRoot: string;
      sourceLaneId: string;
      targetLaneId: string;
    }) => Promise<CodingHandoffPreviewResult>;
    handoff: (input: {
      workspaceRoot: string;
      sourceLaneId: string;
      targetLaneId: string;
    }) => Promise<CodingAgentActionResult>;
    addLane: (input: {
      workspaceRoot: string;
      missionId: string;
      profileId: string;
    }) => Promise<CodingAgentActionResult>;
    createCollaborationPreset: (
      input: import('../../shared/codingAgent').CreateCodingCollaborationPresetInput,
    ) => Promise<CodingAgentActionResult>;
    saveLaneView: (input: {
      workspaceRoot: string;
      view: import('../../shared/codingAgent').CodingLaneViewStateInput;
    }) => Promise<CodingAgentActionResult>;
    setLaneConfigOption: (input: {
      workspaceRoot: string;
      option: import('../../shared/codingAgent').CodingLaneConfigOptionInput;
    }) => Promise<CodingAgentActionResult>;
    setLaneModelOverride: (input: {
      workspaceRoot: string;
      laneId: string;
      modelOverride: string | null;
    }) => Promise<CodingAgentActionResult>;
    previewLaneChanges: (input: {
      workspaceRoot: string;
      laneId: string;
    }) => Promise<CodingLaneChangePreviewResult>;
    applyLaneChanges: (input: {
      workspaceRoot: string;
      laneId: string;
    }) => Promise<CodingAgentActionResult>;
    getGitStatus: (
      input: import('../../shared/codingAgent').CodingGitTargetInput,
    ) => Promise<CodingGitStatusResult>;
    getGitDiff: (
      input: import('../../shared/codingAgent').CodingGitDiffInput,
    ) => Promise<CodingGitDiffResult>;
    stageGitPaths: (
      input: import('../../shared/codingAgent').CodingGitPathActionInput,
    ) => Promise<CodingGitStatusResult>;
    unstageGitPaths: (
      input: import('../../shared/codingAgent').CodingGitPathActionInput,
    ) => Promise<CodingGitStatusResult>;
    commitGitChanges: (
      input: import('../../shared/codingAgent').CodingGitCommitInput,
    ) => Promise<CodingGitStatusResult>;
    commitAndPushGitChanges: (
      input: import('../../shared/codingAgent').CodingGitCommitAndPushInput,
    ) => Promise<CodingGitCommitAndPushActionResult>;
    pushGitBranch: (
      input: import('../../shared/codingAgent').CodingGitTargetInput,
    ) => Promise<CodingGitStatusResult>;
    switchGitBranch: (
      input: import('../../shared/codingAgent').CodingGitBranchInput,
    ) => Promise<CodingGitStatusResult>;
    createGitBranch: (
      input: import('../../shared/codingAgent').CodingGitBranchInput,
    ) => Promise<CodingGitStatusResult>;
    createGitPullRequest: (
      input: import('../../shared/codingAgent').CodingGitPullRequestInput,
    ) => Promise<{ success: boolean; url?: string; error?: string }>;
    listWorkspaceFiles: (
      input: import('../../shared/codingAgent').CodingWorkspaceFileInput,
    ) => Promise<{
      success: boolean;
      entries?: import('../../shared/codingAgent').CodingWorkspaceFileEntry[];
      error?: string;
    }>;
    readWorkspaceFile: (
      input: import('../../shared/codingAgent').CodingWorkspaceFileInput,
    ) => Promise<{
      success: boolean;
      file?: import('../../shared/codingAgent').CodingWorkspaceFileContent;
      error?: string;
    }>;
    writeWorkspaceFile: (
      input: import('../../shared/codingAgent').CodingWorkspaceFileWriteInput,
    ) => Promise<{
      success: boolean;
      file?: import('../../shared/codingAgent').CodingWorkspaceFileContent;
      error?: string;
    }>;
    discoverAgents: (input: { workspaceRoot: string }) => Promise<CodingAgentActionResult>;
    probeAgent: (input: {
      workspaceRoot: string;
      profileId: string;
    }) => Promise<CodingAgentActionResult>;
    addProfile: (input: {
      workspaceRoot: string;
      profile: import('../../shared/codingAgent').AddCodingAgentProfileInput;
    }) => Promise<CodingAgentActionResult>;
    trustProfile: (input: {
      workspaceRoot: string;
      profileId: string;
    }) => Promise<CodingAgentActionResult>;
    authenticateProfile: (input: {
      workspaceRoot: string;
      profileId: string;
      methodId: string;
    }) => Promise<CodingAgentActionResult>;
    startAuthTerminal: (input: {
      workspaceRoot: string;
      profileId: string;
      methodId: string;
    }) => Promise<{
      success: boolean;
      terminal?: { id: string; profileId: string; methodId: string };
      error?: string;
    }>;
    writeAuthTerminal: (input: { id: string; data: string }) => Promise<CodingAgentActionResult>;
    resizeAuthTerminal: (input: {
      id: string;
      columns: number;
      rows: number;
    }) => Promise<CodingAgentActionResult>;
    cancelAuthTerminal: (id: string) => Promise<CodingAgentActionResult>;
    respondPermission: (input: {
      workspaceRoot: string;
      response: import('../../shared/codingAgent').CodingPermissionResponse;
    }) => Promise<CodingAgentActionResult>;
    onChanged: (
      callback: (snapshot: import('../../shared/codingAgent').CodingRoomSnapshot) => void,
    ) => () => void;
    onEventDelta: (
      callback: (delta: import('../../shared/codingAgent').CodingRoomEventDelta) => void,
    ) => () => void;
    loadEventPage: (input: {
      workspaceRoot: string;
      laneId: string;
      beforeSequence: number | null;
    }) => Promise<{
      success: boolean;
      page?: import('../../shared/codingAgent').CodingEventPage;
      error?: string;
    }>;
    onPendingMessagesChanged: (
      callback: (
        event: import('../../shared/codingAgent').CodingPendingMessagesChangedEvent,
      ) => void,
    ) => () => void;
    onAuthTerminalData: (callback: (event: { id: string; data: string }) => void) => () => void;
    onAuthTerminalExit: (
      callback: (event: {
        id: string;
        profileId: string;
        methodId: string;
        exitCode: number;
        signal?: number;
      }) => void,
    ) => () => void;
  };
  dialog: {
    selectDirectory: (options?: {
      defaultPath?: string;
    }) => Promise<{ success: boolean; path: string | null }>;
    selectFile: (options?: {
      title?: string;
      filters?: { name: string; extensions: string[] }[];
    }) => Promise<{ success: boolean; path: string | null }>;
    selectFiles: (options?: {
      title?: string;
      filters?: { name: string; extensions: string[] }[];
    }) => Promise<{ success: boolean; paths: string[] }>;
    saveInlineFile: (options: {
      dataBase64: string;
      fileName?: string;
      mimeType?: string;
      cwd?: string;
    }) => Promise<{ success: boolean; path: string | null; error?: string }>;
    readFileAsDataUrl: (
      filePath: string,
    ) => Promise<{ success: boolean; dataUrl?: string; error?: string }>;
    checkArtifactFile: (filePath: string) => Promise<{ success: boolean }>;
    generateThumbnail: (
      filePath: string,
    ) => Promise<{ success: boolean; dataUrl?: string; error?: string }>;
    showMessageBox: (options: {
      message: string;
      type?: 'none' | 'info' | 'error' | 'question' | 'warning';
      title?: string;
    }) => Promise<{ response: number }>;
  };
  project: {
    getDefaultBaseDir: () => Promise<{ success: boolean; path: string | null; error?: string }>;
    createDirectory: (options: { name: string; baseDir?: string }) => Promise<{
      success: boolean;
      path: string | null;
      code?: 'invalid-name' | 'already-exists';
      error?: string;
    }>;
    ensureScratchDir: () => Promise<{ success: boolean; path: string | null; error?: string }>;
    createRandomWorkspace: () => Promise<{ success: boolean; path: string | null; error?: string }>;
  };
  shell: {
    openPath: (filePath: string) => Promise<{ success: boolean; error?: string }>;
    showItemInFolder: (filePath: string) => Promise<{ success: boolean; error?: string }>;
    openExternal: (url: string) => Promise<{ success: boolean; error?: string }>;
    openHtmlInBrowser: (htmlContent: string) => Promise<{ success: boolean; error?: string }>;
    pathExists: (
      filePath: string,
    ) => Promise<{ success: boolean; exists: boolean; error?: string }>;
  };
  autoLaunch: {
    get: () => Promise<{ enabled: boolean }>;
    set: (enabled: boolean) => Promise<{ success: boolean; error?: string }>;
  };
  preventSleep: {
    get: () => Promise<{ enabled: boolean }>;
    set: (enabled: boolean) => Promise<{ success: boolean; error?: string }>;
  };
  appInfo: {
    getVersion: () => Promise<string>;
    isDev: () => Promise<boolean>;
    isEnterprise: () => Promise<boolean>;
    getSystemLocale: () => Promise<string>;
    consumePendingLocalInferenceInstall: () => Promise<string | null>;
    relaunch: () => Promise<void>;
  };
  appUpdate: {
    getState: () => Promise<AppUpdateRuntimeState>;
    checkNow: (options?: {
      manual?: boolean;
      userId?: string | null;
    }) => Promise<AppUpdateCheckResult>;
    retryDownload: () => Promise<{ success: boolean; state: AppUpdateRuntimeState }>;
    pauseDownload: () => Promise<{ success: boolean; state: AppUpdateRuntimeState }>;
    resumeDownload: () => Promise<{ success: boolean; state: AppUpdateRuntimeState }>;
    cancelDownload: () => Promise<{ success: boolean; state: AppUpdateRuntimeState }>;
    installReady: () => Promise<{ success: boolean; state: AppUpdateRuntimeState; error?: string }>;
    revealDownload: () => Promise<{ success: boolean; path?: string; error?: string }>;
    onStateChanged: (callback: (data: AppUpdateRuntimeState) => void) => () => void;
  };
  runtimeNotices: {
    onNotice: (callback: (notice: RuntimeRetryNotice) => void) => () => void;
  };
  log: {
    getPath: () => Promise<string>;
    openFolder: () => Promise<void>;
    exportZip: () => Promise<{
      success: boolean;
      canceled?: boolean;
      path?: string;
      missingEntries?: string[];
      error?: string;
    }>;
    fromRenderer: (level: string, tag: string, message: string) => void;
  };
  scheduledTasks: {
    list: () => Promise<{
      success: boolean;
      tasks?: import('../../scheduledTask/types').ScheduledTask[];
      error?: string;
    }>;
    get: (id: string) => Promise<{
      success: boolean;
      task?: import('../../scheduledTask/types').ScheduledTask;
      error?: string;
    }>;
    create: (input: import('../../scheduledTask/types').ScheduledTaskInput) => Promise<{
      success: boolean;
      task?: import('../../scheduledTask/types').ScheduledTask;
      error?: string;
    }>;
    update: (
      id: string,
      input: Partial<import('../../scheduledTask/types').ScheduledTaskInput>,
    ) => Promise<{
      success: boolean;
      task?: import('../../scheduledTask/types').ScheduledTask;
      error?: string;
    }>;
    delete: (id: string) => Promise<{ success: boolean; error?: string }>;
    toggle: (
      id: string,
      enabled: boolean,
    ) => Promise<{
      success: boolean;
      task?: import('../../scheduledTask/types').ScheduledTask;
      warning?: string;
      error?: string;
    }>;
    runManually: (id: string) => Promise<{ success: boolean; error?: string }>;
    stop: (id: string) => Promise<{ success: boolean; error?: string }>;
    listRuns: (
      taskId: string,
      limit?: number,
      offset?: number,
      filter?: import('../../scheduledTask/types').RunFilter,
    ) => Promise<{
      success: boolean;
      runs?: import('../../scheduledTask/types').ScheduledTaskRun[];
      error?: string;
    }>;
    countRuns: (taskId: string) => Promise<{ success: boolean; count?: number; error?: string }>;
    listAllRuns: (
      limit?: number,
      offset?: number,
      filter?: import('../../scheduledTask/types').RunFilter,
    ) => Promise<{
      success: boolean;
      runs?: import('../../scheduledTask/types').ScheduledTaskRunWithName[];
      error?: string;
    }>;
    resolveSession: (sessionKey: string) => Promise<{
      success: boolean;
      session?: import('./cowork').CoworkSession | null;
      error?: string;
    }>;
    onStatusUpdate: (
      callback: (data: import('../../scheduledTask/types').ScheduledTaskStatusEvent) => void,
    ) => () => void;
    onRunUpdate: (
      callback: (data: import('../../scheduledTask/types').ScheduledTaskRunEvent) => void,
    ) => () => void;
    onRefresh: (callback: () => void) => () => void;
  };
  permissions: {
    checkCalendar: () => Promise<{
      success: boolean;
      status?: string;
      error?: string;
      autoRequested?: boolean;
    }>;
    requestCalendar: () => Promise<{
      success: boolean;
      granted?: boolean;
      status?: string;
      error?: string;
    }>;
  };
  auth: {
    communityLogin: () => Promise<{ success: boolean; error?: string }>;
    getCommunityUser: () => Promise<{ success: boolean; user?: { id: string; email: string } }>;
    communityLogout: () => Promise<{ success: boolean }>;
    onCommunityCallback: (
      callback: (data: {
        success: boolean;
        user?: { id: string; email: string; name: string };
        error?: string;
      }) => void,
    ) => () => void;
  };
  modelPool: {
    listModels: () => Promise<{
      ok: boolean;
      status: number;
      models: string[];
      error?: string;
    }>;
    stream: (input: {
      requestId: string;
      conversationId: string;
      body: Record<string, unknown>;
    }) => Promise<{
      ok: boolean;
      status: number;
      statusText: string;
      error?: string;
    }>;
    cancelStream: (requestId: string) => Promise<boolean>;
    onStreamData: (requestId: string, callback: (data: string) => void) => () => void;
    onStreamDone: (requestId: string, callback: () => void) => () => void;
    onStreamError: (requestId: string, callback: (error: string) => void) => () => void;
    onStreamAbort: (requestId: string, callback: () => void) => () => void;
  };
  enterprise: {
    getConfig: () => Promise<{
      ui?: Record<string, 'hide' | 'disable' | 'readonly'>;
      disableUpdate?: boolean;
      version: string;
      name: string;
    } | null>;
    renderer: {
      sessionGateEntrypoint: () => Promise<string | null>;
      settingsPages: () => Promise<
        readonly import('../../shared/enterpriseRenderer').EnterpriseRendererSettingsPage[]
      >;
    };
    session: {
      snapshot: () => Promise<EnterpriseSessionResult>;
      login: (input: EnterprisePasswordLoginInput) => Promise<EnterpriseSessionResult>;
      changePassword: (input: EnterprisePasswordChangeInput) => Promise<EnterpriseSessionResult>;
      logout: () => Promise<EnterpriseSessionResult>;
    };
  };
  managedProviders: {
    policy: () => Promise<import('../../shared/managedProviders').ManagedProviderAccessPolicy>;
    catalog: () => Promise<
      readonly import('../../shared/managedProviders').ManagedProviderCatalogModel[]
    >;
    onChanged: (callback: () => void) => () => void;
  };
  networkStatus: {
    send: (status: 'online' | 'offline') => void;
  };
  // 2026/09/17 lixiang  开发态主进程 HTTP 镜像到 DevTools Network
  devNetwork: {
    onEntry: (
      callback: (entry: import('../../shared/devNetworkLog').DevNetworkLogEntry) => void,
    ) => () => void;
  };
  qwen: Record<string, never>;
  githubCopilot: {
    requestDeviceCode: () => Promise<{
      userCode: string;
      verificationUri: string;
      deviceCode: string;
      interval: number;
      expiresIn: number;
    }>;
    pollForToken: (
      deviceCode: string,
      interval: number,
      expiresIn: number,
    ) => Promise<{
      success: boolean;
      token?: string;
      githubUser?: string;
      baseUrl?: string;
      error?: string;
    }>;
    cancelPolling: () => Promise<void>;
    signOut: () => Promise<void>;
    refreshToken: () => Promise<{
      success: boolean;
      token?: string;
      baseUrl?: string;
      error?: string;
    }>;
    onTokenUpdated: (callback: (data: { token: string; baseUrl: string }) => void) => () => void;
  };
  openaiCodexOAuth: {
    start: () => Promise<
      | { success: true; email: string | null; accountId: string | null; expiresAt: number }
      | { success: false; error: string }
    >;
    cancel: () => Promise<void>;
    logout: () => Promise<void>;
    status: () => Promise<
      | { loggedIn: true; email: string | null; accountId: string | null; expiresAt: number }
      | { loggedIn: false }
    >;
  };

  activity: {
    list: () => Promise<{ success: boolean; runs: ActivityRun[] }>;
    onUpdated: (callback: (run: ActivityRun) => void) => () => void;
  };
}

declare global {
  interface Window {
    electron: IElectronAPI;
  }
}

export {};
