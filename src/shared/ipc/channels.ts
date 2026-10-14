/**
 * Centralized IPC channel name constants.
 *
 * Every Electron IPC channel name lives here as an `as const` object.
 * Types are derived from these values so that preload and main share a single source of truth.
 *
 * Pattern (matching existing ScheduledTaskIpc / OllamaIpcChannel convention):
 *   import { CoworkSessionIpc } from '@shared/ipc/channels';
 *   ipcRenderer.invoke(CoworkSessionIpc.Start, options);
 */

// ─── Store ──────────────────────────────────────────────────────────────────
export const StoreIpc = {
  Get: 'store:get',
  Set: 'store:set',
  Remove: 'store:remove',
} as const;
export type StoreIpc = (typeof StoreIpc)[keyof typeof StoreIpc];

export const HardwareIpc = {
  NvidiaSmi: 'hardware:nvidia-smi',
  SystemMemory: 'hardware:system-memory',
} as const;
export type HardwareIpc = (typeof HardwareIpc)[keyof typeof HardwareIpc];

// ─── Permissions ────────────────────────────────────────────────────────────
export const PermissionsIpc = {
  CheckCalendar: 'permissions:checkCalendar',
  RequestCalendar: 'permissions:requestCalendar',
} as const;
export type PermissionsIpc = (typeof PermissionsIpc)[keyof typeof PermissionsIpc];

// ─── Todo ───────────────────────────────────────────────────────────────────
export { TodoIpc, type TodoIpc as TodoIpcChannel } from '../todo/constants';

// ─── Enterprise ─────────────────────────────────────────────────────────────
export const EnterpriseIpc = {
  GetConfig: 'enterprise:getConfig',
} as const;
export type EnterpriseIpc = (typeof EnterpriseIpc)[keyof typeof EnterpriseIpc];

export const ManagedProviderIpc = {
  Policy: 'enterprise:managed-provider:policy',
  Catalog: 'enterprise:managed-provider:catalog',
  Changed: 'enterprise:managed-provider:changed',
} as const;
export type ManagedProviderIpc = (typeof ManagedProviderIpc)[keyof typeof ManagedProviderIpc];

// ─── API (HTTP proxy) ───────────────────────────────────────────────────────
export const ApiIpc = {
  Fetch: 'api:fetch',
  FetchModels: 'api:fetch-models',
} as const;

// ─── ZhiYuan Model Pool ────────────────────────────────────────────────────
export const ModelPoolIpc = {
  ListModels: 'model-pool:list-models',
  Stream: 'model-pool:stream',
  CancelStream: 'model-pool:stream:cancel',
  streamData: (requestId: string) => `model-pool:stream:${requestId}:data`,
  streamDone: (requestId: string) => `model-pool:stream:${requestId}:done`,
  streamError: (requestId: string) => `model-pool:stream:${requestId}:error`,
  streamAbort: (requestId: string) => `model-pool:stream:${requestId}:abort`,
} as const;
export type ModelPoolIpc = (typeof ModelPoolIpc)[keyof typeof ModelPoolIpc];

// ─── Window ─────────────────────────────────────────────────────────────────
export const WindowIpc = {
  Minimize: 'window-minimize',
  ToggleMaximize: 'window-maximize',
  Close: 'window-close',
  IsMaximized: 'window:isMaximized',
  ShowSystemMenu: 'window:showSystemMenu',
  StateChanged: 'window:state-changed',
  ToggleDevTools: 'window:toggleDevTools',
  OpenDevTools: 'window:openDevTools',
} as const;
export type WindowIpc = (typeof WindowIpc)[keyof typeof WindowIpc];

export const ContextMenuIpc = {
  Open: 'context-menu:open',
  Execute: 'context-menu:execute',
} as const;
export type ContextMenuIpc = (typeof ContextMenuIpc)[keyof typeof ContextMenuIpc];

// ─── App-level config ───────────────────────────────────────────────────────
export const AppConfigIpc = {
  GetApiConfig: 'get-api-config',
  CheckApiConfig: 'check-api-config',
  SaveApiConfig: 'save-api-config',
  GenerateSessionTitle: 'generate-session-title',
  GetRecentCwds: 'get-recent-cwds',
} as const;
export type AppConfigIpc = (typeof AppConfigIpc)[keyof typeof AppConfigIpc];

// ─── Agent Engine ──────────────────────────────────────────────────────────
// ─── Cowork Session ─────────────────────────────────────────────────────────
export const CoworkSessionIpc = {
  Start: 'cowork:session:start',
  Continue: 'cowork:session:continue',
  Stop: 'cowork:session:stop',
  Compact: 'cowork:session:compact',
  Save: 'cowork:session:save',
  Delete: 'cowork:session:delete',
  DeleteBatch: 'cowork:session:deleteBatch',
  Pin: 'cowork:session:pin',
  Rename: 'cowork:session:rename',
  UpdateModel: 'cowork:session:updateModel',
  Get: 'cowork:session:get',
  RunSnapshot: 'cowork:session:runSnapshot',
  List: 'cowork:session:list',
  GetMessages: 'cowork:session:getMessages',
  ExportResultImage: 'cowork:session:exportResultImage',
  CaptureImageChunk: 'cowork:session:captureImageChunk',
  SaveResultImage: 'cowork:session:saveResultImage',
  ExportText: 'cowork:session:exportText',
} as const;
export type CoworkSessionIpc = (typeof CoworkSessionIpc)[keyof typeof CoworkSessionIpc];

// 鈹€鈹€鈹€ Cowork pending Work messages 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
export const CoworkQueueIpc = {
  List: 'cowork:queue:list',
  Enqueue: 'cowork:queue:enqueue',
  Update: 'cowork:queue:update',
  Delete: 'cowork:queue:delete',
  Steer: 'cowork:queue:steer',
  FollowUp: 'cowork:queue:followUp',
} as const;
export type CoworkQueueIpc = (typeof CoworkQueueIpc)[keyof typeof CoworkQueueIpc];

// ─── Cowork Permission ──────────────────────────────────────────────────────
export const CoworkPermissionIpc = {
  Respond: 'cowork:permission:respond',
} as const;
export type CoworkPermissionIpc = (typeof CoworkPermissionIpc)[keyof typeof CoworkPermissionIpc];

// ─── Cowork Config ──────────────────────────────────────────────────────────
export const CoworkConfigIpc = {
  Get: 'cowork:config:get',
  Set: 'cowork:config:set',
} as const;
export type CoworkConfigIpc = (typeof CoworkConfigIpc)[keyof typeof CoworkConfigIpc];

// ─── Cowork Stream ──────────────────────────────────────────────────────────
export const CoworkStreamIpc = {
  RunState: 'cowork:stream:runState',
  ContentPatch: 'cowork:stream:contentPatch',
  RuntimeSnapshots: 'cowork:stream:runtimeSnapshots',
  UiEvent: 'cowork:stream:uiEvent',
  SessionsChanged: 'cowork:sessions:changed',
} as const;
export type CoworkStreamIpc = (typeof CoworkStreamIpc)[keyof typeof CoworkStreamIpc];

// ─── Project (working directory helpers) ────────────────────────────────────
export const ProjectIpc = {
  GetDefaultBaseDir: 'project:getDefaultBaseDir',
  CreateDirectory: 'project:createDirectory',
  EnsureScratchDir: 'project:ensureScratchDir',
  CreateRandomWorkspace: 'project:createRandomWorkspace',
} as const;
export type ProjectIpc = (typeof ProjectIpc)[keyof typeof ProjectIpc];

// ─── Dialog ─────────────────────────────────────────────────────────────────
export const DialogIpc = {
  SelectDirectory: 'dialog:selectDirectory',
  SelectFile: 'dialog:selectFile',
  SelectFiles: 'dialog:selectFiles',
  SaveInlineFile: 'dialog:saveInlineFile',
  ReadFileAsDataUrl: 'dialog:readFileAsDataUrl',
  CheckArtifactFile: 'dialog:checkArtifactFile',
  GenerateThumbnail: 'dialog:generateThumbnail',
  ShowMessageBox: 'dialog:showMessageBox',
} as const;
export type DialogIpc = (typeof DialogIpc)[keyof typeof DialogIpc];

// ─── Shell ──────────────────────────────────────────────────────────────────
export const ShellIpc = {
  OpenPath: 'shell:openPath',
  ShowItemInFolder: 'shell:showItemInFolder',
  OpenExternal: 'shell:openExternal',
  OpenHtmlInBrowser: 'shell:openHtmlInBrowser',
  PathExists: 'shell:pathExists',
} as const;
export type ShellIpc = (typeof ShellIpc)[keyof typeof ShellIpc];

// ─── App (lifecycle) ────────────────────────────────────────────────────────
export const AppIpc = {
  GetAutoLaunch: 'app:getAutoLaunch',
  SetAutoLaunch: 'app:setAutoLaunch',
  GetPreventSleep: 'app:getPreventSleep',
  SetPreventSleep: 'app:setPreventSleep',
  GetVersion: 'app:getVersion',
  IsDev: 'app:isDev',
  IsEnterprise: 'app:isEnterprise',
  GetSystemLocale: 'app:getSystemLocale',
  ConsumePendingLocalInferenceInstall: 'app:consumePendingLocalInferenceInstall',
  Relaunch: 'app:relaunch',
} as const;
export type AppIpc = (typeof AppIpc)[keyof typeof AppIpc];

// ─── Log ────────────────────────────────────────────────────────────────────
export const LogIpc = {
  GetPath: 'log:getPath',
  OpenFolder: 'log:openFolder',
  ExportZip: 'log:exportZip',
  FromRenderer: 'log:fromRenderer',
} as const;
export type LogIpc = (typeof LogIpc)[keyof typeof LogIpc];

// ─── IM ─────────────────────────────────────────────────────────────────────
export const CommunityAuthIpc = {
  Login: 'auth:communityLogin',
  GetCommunityUser: 'auth:getCommunityUser',
  Logout: 'auth:communityLogout',
  Callback: 'auth:communityCallback',
} as const;
export type CommunityAuthIpc = (typeof CommunityAuthIpc)[keyof typeof CommunityAuthIpc];

// ─── GitHub Copilot ─────────────────────────────────────────────────────────
export const GitHubCopilotIpc = {
  RequestDeviceCode: 'github-copilot:request-device-code',
  PollForToken: 'github-copilot:poll-for-token',
  CancelPolling: 'github-copilot:cancel-polling',
  SignOut: 'github-copilot:sign-out',
  RefreshToken: 'github-copilot:refresh-token',
  TokenUpdated: 'github-copilot:token-updated',
} as const;
export type GitHubCopilotIpc = (typeof GitHubCopilotIpc)[keyof typeof GitHubCopilotIpc];

// ─── OpenAI Codex OAuth ─────────────────────────────────────────────────────
export const OpenAICodexOAuthIpc = {
  Start: 'openai-codex-oauth:start',
  Cancel: 'openai-codex-oauth:cancel',
  Logout: 'openai-codex-oauth:logout',
  Status: 'openai-codex-oauth:status',
} as const;
export type OpenAICodexOAuthIpc = (typeof OpenAICodexOAuthIpc)[keyof typeof OpenAICodexOAuthIpc];

// ─── Network ────────────────────────────────────────────────────────────────
export const NetworkIpc = {
  StatusChange: 'network:status-change',
} as const;
export type NetworkIpc = (typeof NetworkIpc)[keyof typeof NetworkIpc];

// ─── Agent runtime notices ──────────────────────────────────────────────────
/** Transient runtime status the renderer shows once and never persists. */
export const RuntimeNoticeIpc = {
  Notice: 'runtime:notice',
} as const;
export type RuntimeNoticeIpc = (typeof RuntimeNoticeIpc)[keyof typeof RuntimeNoticeIpc];

// 2026/09/17 lixiang  开发态主进程 HTTP → 渲染进程 Network beacon
export const DevNetworkIpc = {
  Entry: 'dev-network:entry',
} as const;
export type DevNetworkIpc = (typeof DevNetworkIpc)[keyof typeof DevNetworkIpc];
