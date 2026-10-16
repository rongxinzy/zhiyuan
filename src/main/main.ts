import Database from 'better-sqlite3';
import { registerHistoryIpc } from './history/registerHistoryIpc';
import { runPendingHistoryMaintenance } from './history/historyMaintenance';
import { loadRestoredNativeGuard } from './history/restoredNativeGuard';
import crypto from 'crypto';
import type { WebContents } from 'electron';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  net,
  powerMonitor,
  powerSaveBlocker,
  protocol,
  screen,
  session,
  shell,
} from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';

import { buildSessionTitleFromInput } from '../common/sessionTitle';
import { parseCoworkExecutionMode } from '../shared/cowork/executionMode';
import { createPiUiEventBatcher } from './piUiEventBatcher';
import { broadcastTaskBoardWorkEvent } from './taskBoard/broadcastWorkEvent';
import { mapPiUiEventToWorkEvent } from './taskBoard/mapPiUiEventToWorkEvent';
import { persistCoworkTerminalError } from './coworkTerminalErrorPersistence';
import { bindCoworkContentBridge } from './coworkContentBridge';
import { registerArtifactFileAvailabilityHandler } from './artifactFileAvailability';

import { LocalSchedulerRuntime } from '../scheduledTask/localSchedulerRuntime';
import { CanonicalScheduledTaskService } from '../scheduledTask/canonicalScheduledTaskService';
import { PiScheduledTaskExecutor } from '../scheduledTask/piScheduledTaskExecutor';
import { SqliteScheduledTaskStore } from '../scheduledTask/sqliteScheduledTaskStore';
import { IpcChannel as ScheduledTaskIpc } from '../scheduledTask/constants';
import { ActivityService } from './activity/activityService';
import { registerActivityIpcHandlers } from './activity/ipcHandlers';
import { COMMUNITY_AUTH_ORIGIN, configureCommunityAuthSession } from './communityAuthSession';
import { AgentIpcChannel } from '../shared/agent/constants';
import {
  APP_UPDATE_POLL_INTERVAL_MS,
  APP_UPDATE_STARTUP_DELAY_JITTER_MS,
  APP_UPDATE_STARTUP_DELAY_MIN_MS,
  AppUpdateIpc,
  AppUpdateStatus,
} from '../shared/appUpdate/constants';
import {
  CoworkExecutionMode,
  COWORK_MESSAGE_PAGE_SIZE,
  COWORK_SESSION_PAGE_SIZE,
  CoworkCompactFailure,
  type CoworkCompactResult,
  CoworkPermissionMode,
  CoworkSessionMode,
  CoworkSessionSource,
  normalizeRenamedSessionTitle,
} from '../shared/cowork/constants';
import {
  type CoworkSessionExpertInput,
  type CoworkSessionExpertSnapshot,
  CoworkSessionExpertSource,
  normalizeSingleExpertIds,
} from '../shared/cowork/sessionExperts';
import {
  ApiIpc,
  AppIpc,
  CommunityAuthIpc,
  CoworkPermissionIpc,
  CoworkQueueIpc,
  CoworkSessionIpc,
  CoworkStreamIpc,
  HardwareIpc,
  ManagedProviderIpc,
  ProjectIpc,
  RuntimeNoticeIpc,
  ShellIpc,
  WindowIpc,
} from '../shared/ipc/channels';
import type { RuntimeRetryNotice } from '../common/runtimeNotice';
import { EnterpriseSessionIpc } from '../shared/enterpriseSession';
import { EnterpriseRendererIpc } from '../shared/enterpriseRenderer';
import {
  CoworkQueueEnqueueSchema,
  CoworkQueueItemSchema,
  CoworkQueueSessionSchema,
  CoworkQueueUpdateSchema,
} from '../shared/ipc/queueSchemas';
import {
  ApiFetchSchema,
  CoworkSessionContinueSchema,
  CoworkSessionStartSchema,
  CoworkSessionUpdateModelSchema,
  ProjectCreateDirectorySchema,
} from '../shared/ipc/schemas';
import { shouldRecordApiRequest } from '../shared/ipc/apiRequest';
import { WorkspaceIpc, WorkspaceStoreKey } from '../shared/workspace';
import { ToolApprovalMode } from '../shared/cowork/approval';
import { AgentManager } from './agentManager';
import { registerModelPoolIpcHandlers } from './modelPoolIpc';
import {
  APP_DATA_DIR_NAME,
  APP_NAME,
  APP_USER_MODEL_ID,
  DB_FILENAME,
  ENTERPRISE_APP_NAME,
  resolveAppDataDirName,
} from './appConstants';
import { AppQuitOrigin, getAppQuitOrigin, recordAppQuitOrigin } from './appQuitOrigin';
import { getAutoLaunchEnabled, isAutoLaunched, setAutoLaunchEnabled } from './autoLaunchManager';
import { getChangedSessionPermissionModes } from './coworkPermissionModeChanges';
import type { CoworkPromptLanguage } from './coworkLanguagePrompt';
import { composeCoworkSystemPrompt } from './coworkPrompt/composer';
import { reconcileWorkSessionRuntimeState } from './coworkSessionRuntimeState';
import {
  coworkImageRoot,
  deleteCoworkSessionImages,
  persistCoworkImageAttachments,
  persistMessageImageMetadata,
  slimImageAttachmentsForIpc,
  slimQueuedMessagesForIpc,
} from './coworkImageAttachments';

import {
  type CoworkMessageMetadata,
  type CoworkMessageType,
  type CoworkSessionStatus,
  CoworkStore,
} from './coworkStore';
import {
  getDefaultConversationWorkspacePath,
  isDefaultConversationWorkspacePath,
} from './defaultConversationWorkspace';
import { setLanguage, t } from './i18n';

import { getLlamaCppServiceConfig, registerLlamaCppIpcHandlers } from './ipcHandlers/llamacpp';
import type { LlamaCppModelDaemonController } from './libs/llamacppModelDaemonController';
import { registerMarketplaceIpcHandlers } from './ipcHandlers/marketplace';
import { getOllamaServiceConfig, registerOllamaIpcHandlers } from './ipcHandlers/ollama';
import {
  getCronJobService,
  initCronJobServiceManager,
  registerScheduledTaskHandlers,
} from './ipcHandlers/scheduledTask';
import { registerTriageIpcHandlers } from './ipcHandlers/triage';
import { registerCodingAgentIpcHandlers } from './ipcHandlers/codingAgent';
import { agentResourceDiagnostics } from './agentResourceDiagnostics';
import { CodingRoomRepository } from './codingAgent/codingRoomRepository';
import { CodingRoomService } from './codingAgent/codingRoomService';
import { resolveCodingExpertSelection } from './codingAgent/builtinCodingExpertSelection';
import { resolveAcpAdapterRoot } from './codingAgent/acp/adapterRoot';
import { CodingAgentRegistry } from './codingAgent/codingAgentRegistry';
import { CodingAgentProfileRepository } from './codingAgent/codingAgentProfileRepository';
import { GitWorktreeService } from './codingAgent/gitWorktreeService';
import { PiUiRuntimeSnapshots } from '../shared/cowork/piUiRuntimeSnapshot';
import {
  type PiUiEvent,
  type PiUiEventPayload,
  type PiUiMessage,
  PiUiEventType,
  PiUiEventSequencer,
} from '../shared/cowork/piUiEvent';
import { bindBuiltinCodingRuntime } from './codingAgent/bindBuiltinCodingRuntime';
import { registerTodoIpcHandlers } from './todo/ipc';
import { TodoReminderScheduler } from './todo/reminderScheduler';
import { type PermissionResult, PiRuntimeAdapter } from './libs/agentEngine';
import { registerDurableIpc } from './libs/agentEngine/durable/ipc';
import { registerWorkDocumentIpc } from './libs/agentEngine/durable/workDocumentIpc';
import { MagpieManager } from './magpie/manager';
import { shutdownPythonRuntime } from './pythonRuntime/host';
import { registerMagpieIpc } from './magpie/registerIpc';
import type { PiThinkingLevel } from './libs/agentEngine/piRuntimeTypes';
import { MagpieModelService, installMagpieModelService } from './magpie/modelService';
import { ManagedMagpieProviderBindings } from './magpie/managedProviderBindings';
import { readOllamaProviderSnapshot } from './magpie/ollamaProviderBinding';
import { buildLlamaCppRunningModelBinding } from './libs/llamacppAgentBinding';
import {
  projectAppPreferences,
  mergeAppPreferences,
  isManagedModelPreference,
} from './appPreferences';
import { AppUpdateCoordinator } from './libs/appUpdateCoordinator';
import {
  chooseTriageModelSwitch,
  classifyMessage,
  createTriageState,
} from './libs/agentEngine/modelTriage';
import { DEFAULT_TRIAGE_CONFIG, type TriageConfig, type TriageState } from '../shared/triage';
import { getCoworkLogPath } from './libs/coworkLogger';
import { generateSessionTitle, probeCoworkModelReadiness } from './libs/coworkUtil';
import { createContentSecurityPolicy } from './contentSecurityPolicy';
import { registerZhiyuanDeepLinkProtocol } from './deepLinkRegistration';
import { resolveEnterpriseConfigPath, syncEnterpriseConfig } from './libs/enterpriseConfigSync';
import {
  disposeZhiyuanEnterpriseExtension,
  initializeZhiyuanEnterpriseExtension,
  isEnterpriseBuild,
} from './enterpriseExtension/host';
import {
  ZHIYUAN_ENTERPRISE_RENDERER_SCHEME,
  zhiyuanEnterpriseRendererBridge,
} from './enterpriseExtension/rendererBridge';
import {
  allowEnterpriseRendererOpaqueOrigin,
  ZHIYUAN_ENTERPRISE_RENDERER_PROTOCOL_PRIVILEGES,
} from './enterpriseExtension/rendererProtocol';
import { zhiyuanEnterpriseSessionBridge } from './enterpriseExtension/sessionBridge';
import { zhiyuanManagedProviderBridge } from './enterpriseExtension/managedProviderBridge';

import { setPlatformFetchNetworkLogger } from './aisphere/transport';
import {
  registerDevNetworkProtocol,
  trackDevNetworkRequest,
  publishDevNetworkLog,
} from './devNetworkLog';
import { truncateNetworkBody } from '../shared/devNetworkLog';

import { LlamaCppManager } from './libs/llamacppManager';

import { generateCorrelationId, runWithCorrelationId } from './libs/logCorrelation';
import { exportLogsZip } from './libs/logExport';

import { getNvidiaSmiSnapshot } from './libs/nvidiaSmi';
import { getSystemMemorySnapshot } from './libs/systemMemory';
import { OllamaManager } from './libs/ollamaManager';
import { consumePendingLocalInferenceInstall } from './libs/pendingLocalInferenceInstall';

import { serializeForLog } from './libs/sanitizeForLog';
import { SqliteBackupManager } from './libs/sqliteBackup/sqliteBackupManager';
import { createLogger } from './libs/structuredLog';
import {
  applySystemProxyEnv,
  resolveSystemProxyUrlForTargets,
  restoreOriginalProxyEnv,
  setSystemProxyEnabled,
} from './libs/systemProxy';
import { getLogFilePath, getRecentMainLogEntries, initLogger, log } from './logger';

import { shouldReloadRendererProcess } from './rendererProcessRecovery';
import { configureRendererStartup } from './rendererStartup';

import { SqliteStore } from './sqliteStore';
import { startSqliteDiagnostics } from './sqliteDiagnostics';
import { createUncaughtReporter, installStdioErrorGuards } from './stdioErrorGuard';
import { StartupProfiler } from './startupProfiler';
import { createTray, destroyTray, updateTrayMenu } from './trayManager';
import { registerContextMenu } from './contextMenu';
import {
  AppWindowStoreKey,
  MIN_APP_WINDOW_HEIGHT,
  MIN_APP_WINDOW_WIDTH,
  resolveInitialAppWindowState,
  type WindowRectangle,
} from './windowState';

// The enterprise packaging overlay injects the extension module into resources;
// the public build has no such module and keeps the regular Zhiyuan name. The
// same detection also selects the enterprise application data root, so product
// naming and storage isolation can never disagree.
const isEnterprise = isEnterpriseBuild({
  isPackaged: app.isPackaged,
  resourcesPath: process.resourcesPath,
  developmentExtensionPath: process.env.ZHIYUAN_ENTERPRISE_EXTENSION_DEV_PATH,
});
const runtimeAppName = isEnterprise ? ENTERPRISE_APP_NAME : APP_NAME;

// 设置应用程序名称
app.name = runtimeAppName;
app.setName(runtimeAppName);
// 2026/09/21 lixiang  开发态用独立 AUMID，并配套开始菜单快捷方式（见 ensureWindowsTaskbarBrand），
// 避免 Windows 继续拿 Electron 默认原子图标的任务栏缓存。打包态仍用产品 AUMID。
const WINDOWS_TASKBAR_APP_USER_MODEL_ID = app.isPackaged
  ? APP_USER_MODEL_ID
  : `${APP_USER_MODEL_ID}.dev`;
if (process.platform === 'win32') {
  app.setAppUserModelId(WINDOWS_TASKBAR_APP_USER_MODEL_ID);
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: ZHIYUAN_ENTERPRISE_RENDERER_SCHEME,
    privileges: ZHIYUAN_ENTERPRISE_RENDERER_PROTOCOL_PRIVILEGES,
  },
  // 2026/09/17 lixiang  开发态 xr-net beacon，主进程请求可出现在 DevTools Network
  ...(process.env.NODE_ENV === 'development'
    ? [
        {
          scheme: 'xr-net',
          privileges: {
            standard: true,
            secure: true,
            supportFetchAPI: true,
            corsEnabled: true,
            bypassCSP: true,
          },
        },
      ]
    : []),
]);

const INVALID_FILE_NAME_PATTERN = /[<>:"/\\|?*\u0000-\u001F]/g;
const IPC_MESSAGE_CONTENT_MAX_CHARS = 120_000;
const IPC_STRING_MAX_CHARS = 4_000;
const IPC_MAX_DEPTH = 5;
const IPC_MAX_KEYS = 80;
const IPC_MAX_ITEMS = 40;
const MAX_INLINE_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const PowerSaveBlockerType = {
  PreventAppSuspension: 'prevent-app-suspension',
} as const;
const MIME_EXTENSION_MAP: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/bmp': '.bmp',
  'application/pdf': '.pdf',
  'text/plain': '.txt',
  'text/markdown': '.md',
  'application/json': '.json',
  'text/csv': '.csv',
};

const sanitizeExportFileName = (value: string): string => {
  const sanitized = value.replace(INVALID_FILE_NAME_PATTERN, ' ').replace(/\s+/g, ' ').trim();
  return sanitized || 'cowork-session';
};

const resolveDefaultAgentModelRef = (): string =>
  getStore().get<string>('magpie_default_model_id') ?? '';

const triageStatesBySession = new Map<string, TriageState>();

/** Read the triage config from the sqlite kv store (same key as the IPC handlers). */
const readTriageConfig = (): TriageConfig => {
  try {
    const stored = getStore().get<TriageConfig>('model_triage_config');
    if (stored && typeof stored === 'object' && typeof stored.enabled === 'boolean') {
      return stored;
    }
  } catch {
    // fall through to defaults
  }
  return DEFAULT_TRIAGE_CONFIG;
};

/**
 * Classify the incoming prompt and switch the session model when the triage
 * decision says so. Runs before the prompt is sent; failures never block the
 * turn — the rule result and hysteresis keep routing conservative.
 */
const applyMessageTriageRouting = async (sessionId: string, prompt: string): Promise<void> => {
  const config = readTriageConfig();
  if (!config.enabled || !prompt.trim()) return;

  const session = getCoworkStore().getSession(sessionId, null);
  const messageCount = session?.messages?.length ?? 0;
  const result = await classifyMessage(prompt, messageCount, config);
  const state = triageStatesBySession.get(sessionId) ?? createTriageState();
  const sessionOverride = session?.modelOverride?.trim() || '';
  const currentModelRef = sessionOverride || resolveDefaultAgentModelRef();
  const decision = chooseTriageModelSwitch(
    currentModelRef,
    result,
    state,
    config,
    Math.max(1, messageCount),
  );
  triageStatesBySession.set(sessionId, decision.state);
  if (decision.modelRef) {
    await getPiRuntimeAdapter().patchSession(sessionId, { model: decision.modelRef });
    console.log(`[Triage] session ${sessionId} routed to ${decision.modelRef} (${result.reason})`);
  }
};

const sanitizeAttachmentFileName = (value?: string): string => {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return 'attachment';
  const fileName = path.basename(raw);
  const sanitized = fileName.replace(INVALID_FILE_NAME_PATTERN, ' ').replace(/\s+/g, ' ').trim();
  return sanitized || 'attachment';
};

const inferAttachmentExtension = (fileName: string, mimeType?: string): string => {
  const fromName = path.extname(fileName).toLowerCase();
  if (fromName) {
    return fromName;
  }
  if (typeof mimeType === 'string') {
    const normalized = mimeType.toLowerCase().split(';')[0].trim();
    return MIME_EXTENSION_MAP[normalized] ?? '';
  }
  return '';
};

const resolveInlineAttachmentDir = (cwd?: string): string => {
  const trimmed = typeof cwd === 'string' ? cwd.trim() : '';
  if (trimmed) {
    const resolved = path.resolve(trimmed);
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
      return path.join(resolved, '.cowork-temp', 'attachments', 'manual');
    }
  }
  return path.join(app.getPath('temp'), 'zhiyuan', 'attachments');
};

const ensurePngFileName = (value: string): string => {
  return value.toLowerCase().endsWith('.png') ? value : `${value}.png`;
};

const ensureZipFileName = (value: string): string => {
  return value.toLowerCase().endsWith('.zip') ? value : `${value}.zip`;
};

const padTwoDigits = (value: number): string => value.toString().padStart(2, '0');

const buildLogExportFileName = (): string => {
  const now = new Date();
  const datePart = `${now.getFullYear()}${padTwoDigits(now.getMonth() + 1)}${padTwoDigits(now.getDate())}`;
  const timePart = `${padTwoDigits(now.getHours())}${padTwoDigits(now.getMinutes())}${padTwoDigits(now.getSeconds())}`;
  return `zhiyuan-logs-${datePart}-${timePart}.zip`;
};

const truncateIpcString = (value: string, maxChars: number): string => {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n...[truncated in main IPC forwarding]`;
};

const sanitizeIpcPayload = (value: unknown, depth = 0, seen?: WeakSet<object>): unknown => {
  const localSeen = seen ?? new WeakSet<object>();
  if (
    value === null ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'undefined'
  ) {
    return value;
  }
  if (typeof value === 'string') {
    return truncateIpcString(value, IPC_STRING_MAX_CHARS);
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (typeof value === 'function') {
    return '[function]';
  }
  if (depth >= IPC_MAX_DEPTH) {
    return '[truncated-depth]';
  }
  if (Array.isArray(value)) {
    const result = value
      .slice(0, IPC_MAX_ITEMS)
      .map(entry => sanitizeIpcPayload(entry, depth + 1, localSeen));
    if (value.length > IPC_MAX_ITEMS) {
      result.push(`[truncated-items:${value.length - IPC_MAX_ITEMS}]`);
    }
    return result;
  }
  if (typeof value === 'object') {
    if (localSeen.has(value as object)) {
      return '[circular]';
    }
    localSeen.add(value as object);
    const entries = Object.entries(value as Record<string, unknown>);
    const result: Record<string, unknown> = {};
    for (const [key, entry] of entries.slice(0, IPC_MAX_KEYS)) {
      result[key] = sanitizeIpcPayload(entry, depth + 1, localSeen);
    }
    if (entries.length > IPC_MAX_KEYS) {
      result.__truncated_keys__ = entries.length - IPC_MAX_KEYS;
    }
    return result;
  }
  return String(value);
};

const sanitizeCoworkMessageForIpc = (message: unknown): unknown => {
  if (!message || typeof message !== 'object') {
    return message;
  }
  const messageRecord = message as { metadata?: unknown; content?: unknown };

  // Stream forwarding: truncate large payloads so a single frame cannot stall IPC.
  let sanitizedMetadata: unknown;
  if (messageRecord.metadata && typeof messageRecord.metadata === 'object') {
    const { imageAttachments, fileAttachments, ...rest } = messageRecord.metadata as Record<
      string,
      unknown
    >;
    const sanitizedRest = sanitizeIpcPayload(rest) as Record<string, unknown> | undefined;
    const slimImages = slimImageAttachmentsForIpc(imageAttachments);
    sanitizedMetadata = {
      ...(sanitizedRest && typeof sanitizedRest === 'object' ? sanitizedRest : {}),
      ...(slimImages ? { imageAttachments: slimImages } : {}),
      ...(Array.isArray(fileAttachments) && fileAttachments.length > 0
        ? {
            fileAttachments: fileAttachments
              .filter(
                (attachment): attachment is Record<string, unknown> =>
                  Boolean(attachment) && typeof attachment === 'object',
              )
              .slice(0, IPC_MAX_ITEMS)
              .map(attachment => ({
                name: typeof attachment.name === 'string' ? attachment.name : '',
                path: typeof attachment.path === 'string' ? attachment.path : '',
                extension: typeof attachment.extension === 'string' ? attachment.extension : '',
                ...(typeof attachment.isImage === 'boolean' ? { isImage: attachment.isImage } : {}),
              })),
          }
        : {}),
    };
  } else {
    sanitizedMetadata = undefined;
  }

  return {
    ...message,
    content:
      typeof messageRecord.content === 'string'
        ? truncateIpcString(messageRecord.content, IPC_MESSAGE_CONTENT_MAX_CHARS)
        : '',
    metadata: sanitizedMetadata,
  };
};

/** Session load/save: drop image bytes + redundant toolResult copies. */
const slimCoworkMessageForIpc = (message: unknown): unknown => {
  if (!message || typeof message !== 'object') {
    return message;
  }
  const messageRecord = message as {
    type?: unknown;
    content?: unknown;
    metadata?: unknown;
  };
  const content = typeof messageRecord.content === 'string' ? messageRecord.content : undefined;
  const shouldTruncateToolResult =
    messageRecord.type === 'tool_result' &&
    typeof content === 'string' &&
    content.length > IPC_MESSAGE_CONTENT_MAX_CHARS;

  if (!messageRecord.metadata || typeof messageRecord.metadata !== 'object') {
    if (!shouldTruncateToolResult) return message;
    return {
      ...message,
      content: truncateIpcString(content!, IPC_MESSAGE_CONTENT_MAX_CHARS),
    };
  }

  const { imageAttachments, toolResult, ...rest } = messageRecord.metadata as Record<
    string,
    unknown
  >;
  const slimImages = slimImageAttachmentsForIpc(imageAttachments);
  // Prefer content; only keep metadata.toolResult when content is empty (legacy rows).
  const keepToolResult =
    typeof toolResult === 'string' &&
    toolResult.length > 0 &&
    !(typeof content === 'string' && content.length > 0);

  return {
    ...message,
    ...(shouldTruncateToolResult
      ? { content: truncateIpcString(content!, IPC_MESSAGE_CONTENT_MAX_CHARS) }
      : {}),
    metadata: {
      ...rest,
      ...(slimImages ? { imageAttachments: slimImages } : {}),
      ...(keepToolResult ? { toolResult } : {}),
    },
  };
};

const getCoworkImageRoot = (): string => coworkImageRoot(app.getPath('userData'));

const materializeSessionImages = (
  sessionId: string,
  messages: Array<{ id: string; metadata?: unknown }>,
): void => {
  const root = getCoworkImageRoot();
  const store = getCoworkStore();
  for (const message of messages) {
    if (!message.metadata || typeof message.metadata !== 'object') continue;
    const next = persistMessageImageMetadata(
      root,
      sessionId,
      message.metadata as Record<string, unknown>,
    );
    if (!next.changed || !next.metadata) continue;
    store.updateMessage(
      sessionId,
      message.id,
      { metadata: next.metadata as CoworkMessageMetadata },
      { touchUpdatedAt: false },
    );
    message.metadata = next.metadata;
  }
};

const listAllMatchingSessionIds = (filter: {
  agentId?: string;
  workspaceId?: string;
}): string[] => {
  const store = getCoworkStore();
  const ids: string[] = [];
  const pageSize = 200;
  for (let offset = 0; ; offset += pageSize) {
    const batch = store.listSessions(pageSize, offset, filter.agentId, filter.workspaceId);
    ids.push(...batch.map(session => session.id));
    if (batch.length < pageSize) break;
  }
  return ids;
};

const forgetCoworkSession = (sessionId: string): void => {
  try {
    getPiRuntimeAdapter().onSessionDeleted(sessionId);
  } catch (error) {
    console.error('[Cowork] failed to release session runtime:', error);
  }
  try {
    deleteCoworkSessionImages(getCoworkImageRoot(), sessionId);
  } catch (error) {
    console.error('[Cowork] failed to delete session images:', error);
  }
};

const sanitizeCoworkSessionForIpc = <T extends { messages?: unknown[] }>(session: T): T => {
  if (!session?.messages?.length) return session;
  return {
    ...session,
    messages: session.messages.map(message => slimCoworkMessageForIpc(message)),
  };
};

const sanitizePermissionRequestForIpc = (request: unknown): unknown => {
  if (!request || typeof request !== 'object') {
    return request;
  }
  const requestRecord = request as { toolInput?: unknown };
  return {
    ...request,
    toolInput: sanitizeIpcPayload(requestRecord.toolInput ?? {}),
  };
};

type CaptureRect = { x: number; y: number; width: number; height: number };

const normalizeCaptureRect = (rect?: Partial<CaptureRect> | null): CaptureRect | null => {
  if (!rect) return null;
  const normalized = {
    x: Math.max(0, Math.round(typeof rect.x === 'number' ? rect.x : 0)),
    y: Math.max(0, Math.round(typeof rect.y === 'number' ? rect.y : 0)),
    width: Math.max(0, Math.round(typeof rect.width === 'number' ? rect.width : 0)),
    height: Math.max(0, Math.round(typeof rect.height === 'number' ? rect.height : 0)),
  };
  return normalized.width > 0 && normalized.height > 0 ? normalized : null;
};

const resolveTaskWorkingDirectory = (workspaceRoot: string): string => {
  const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
  // Reject bare Windows drive roots (e.g. "D:\") — mkdir on drive roots causes EPERM,
  // and tool runtimes may fail when given a drive root as workspace.
  if (process.platform === 'win32' && /^[a-zA-Z]:\\?$/.test(resolvedWorkspaceRoot)) {
    throw new Error(
      `Cannot use a drive root as the working directory (${resolvedWorkspaceRoot}). Please select a subfolder instead, for example: ${resolvedWorkspaceRoot}Projects`,
    );
  }
  if (!fs.existsSync(resolvedWorkspaceRoot)) {
    fs.mkdirSync(resolvedWorkspaceRoot, { recursive: true });
  }
  if (!fs.statSync(resolvedWorkspaceRoot).isDirectory()) {
    throw new Error(`Selected workspace is not a directory: ${resolvedWorkspaceRoot}`);
  }
  return resolvedWorkspaceRoot;
};

const getDefaultExportImageName = (defaultFileName?: string): string => {
  const normalized =
    typeof defaultFileName === 'string' && defaultFileName.trim()
      ? defaultFileName.trim()
      : `cowork-session-${Date.now()}`;
  return ensurePngFileName(sanitizeExportFileName(normalized));
};

const savePngWithDialog = async (
  webContents: WebContents,
  pngData: Buffer,
  defaultFileName?: string,
): Promise<{ success: boolean; canceled?: boolean; path?: string; error?: string }> => {
  const defaultName = getDefaultExportImageName(defaultFileName);
  const ownerWindow = BrowserWindow.fromWebContents(webContents);
  const saveOptions = {
    title: 'Export Session Image',
    defaultPath: path.join(app.getPath('downloads'), defaultName),
    filters: [{ name: 'PNG Image', extensions: ['png'] }],
  };
  const saveResult = ownerWindow
    ? await dialog.showSaveDialog(ownerWindow, saveOptions)
    : await dialog.showSaveDialog(saveOptions);

  if (saveResult.canceled || !saveResult.filePath) {
    return { success: true, canceled: true };
  }

  const outputPath = ensurePngFileName(saveResult.filePath);
  await fs.promises.writeFile(outputPath, pngData);
  return { success: true, canceled: false, path: outputPath };
};

const configureUserDataPath = (): void => {
  const memoryLeakTestUserDataPath = process.env.ZHIYUAN_MEMORY_LEAK_TEST_USER_DATA;
  if (memoryLeakTestUserDataPath) {
    app.setPath('userData', memoryLeakTestUserDataPath);
    return;
  }

  const appDataPath = app.getPath('appData');
  const targetUserDataPath = path.join(appDataPath, resolveAppDataDirName(isEnterprise));
  const currentUserDataPath = app.getPath('userData');

  if (currentUserDataPath !== targetUserDataPath) {
    app.setPath('userData', targetUserDataPath);
    console.log(`[Main] userData path updated: ${currentUserDataPath} -> ${targetUserDataPath}`);
  }
};

configureUserDataPath();
initLogger();

const isDev = process.env.NODE_ENV === 'development';
const isLinux = process.platform === 'linux';
const isMac = process.platform === 'darwin';
const isWindows = process.platform === 'win32';
// The packaged Ubuntu smoke test needs an actual painted window. Production
// startup stays hidden until ready-to-show to avoid a flash of empty content.
const isLinuxRendererSmoke = isLinux && process.argv.includes('--zhiyuan-linux-renderer-smoke');
const DEV_SERVER_URL = process.env.ELECTRON_START_URL || 'http://localhost:5175';
const enableVerboseLogging =
  process.env.ELECTRON_ENABLE_LOGGING === '1' || process.env.ELECTRON_ENABLE_LOGGING === 'true';
const reloadOnChildProcessGone =
  process.env.ELECTRON_RELOAD_ON_CHILD_PROCESS_GONE === '1' ||
  process.env.ELECTRON_RELOAD_ON_CHILD_PROCESS_GONE === 'true';
const TITLEBAR_HEIGHT = 48;
const TITLEBAR_COLORS = {
  dark: { color: '#0F1117', symbolColor: '#E4E5E9' },
  // Align light title bar with app light surface-muted tone to reduce visual contrast.
  light: { color: '#F3F4F6', symbolColor: '#1A1D23' },
} as const;

const safeDecodeURIComponent = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const normalizeWindowsShellPath = (inputPath: string): string => {
  if (!isWindows) return inputPath;

  const trimmed = inputPath.trim();
  if (!trimmed) return inputPath;

  let normalized = trimmed;
  if (/^file:\/\//i.test(normalized)) {
    normalized = safeDecodeURIComponent(normalized.replace(/^file:\/\//i, ''));
  }

  if (/^\/[A-Za-z]:/.test(normalized)) {
    normalized = normalized.slice(1);
  }

  const unixDriveMatch = normalized.match(/^[/\\]([A-Za-z])[/\\](.+)$/);
  if (unixDriveMatch) {
    const drive = unixDriveMatch[1].toUpperCase();
    const rest = unixDriveMatch[2].replace(/[/\\]+/g, '\\');
    return `${drive}:\\${rest}`;
  }

  if (/^[A-Za-z]:[/\\]/.test(normalized)) {
    const drive = normalized[0].toUpperCase();
    const rest = normalized.slice(1).replace(/\//g, '\\');
    return `${drive}${rest}`;
  }

  return normalized;
};

// ==================== macOS Permissions ====================

/**
 * Check calendar permission on macOS by attempting to access Calendar app
 * Returns: 'authorized' | 'denied' | 'restricted' | 'not-determined'
 * On Windows, checks if Outlook is available
 * On Linux, returns 'not-supported'
 */
const checkCalendarPermission = async (): Promise<string> => {
  if (process.platform === 'darwin') {
    try {
      // Try to access Calendar to check permission
      const { exec } = require('child_process');
      const util = require('util');
      const execAsync = util.promisify(exec);

      // Quick test to see if we can access Calendar
      await execAsync('osascript -l JavaScript -e \'Application("Calendar").name()\'', {
        timeout: 5000,
      });
      console.log('[Permissions] macOS Calendar access: authorized');
      return 'authorized';
    } catch (error: unknown) {
      const stderr =
        typeof error === 'object' && error && 'stderr' in error
          ? String((error as { stderr?: unknown }).stderr ?? '')
          : '';
      // Check if it's a permission error
      if (
        stderr.includes('不能获取对象') ||
        stderr.includes('not authorized') ||
        stderr.includes('Permission denied')
      ) {
        console.log('[Permissions] macOS Calendar access: not-determined (needs permission)');
        return 'not-determined';
      }
      console.warn('[Permissions] Failed to check macOS calendar permission:', error);
      return 'not-determined';
    }
  }

  if (process.platform === 'win32') {
    // Windows doesn't have a system-level calendar permission like macOS
    // Instead, we check if Outlook is available
    try {
      const { exec } = require('child_process');
      const util = require('util');
      const execAsync = util.promisify(exec);

      // Check if Outlook COM object is accessible
      const checkScript = `
        try {
          $Outlook = New-Object -ComObject Outlook.Application
          $Outlook.Version
        } catch { exit 1 }
      `;
      await execAsync('powershell -Command "' + checkScript + '"', {
        timeout: 10000,
        windowsHide: true,
      });
      console.log('[Permissions] Windows Outlook is available');
      return 'authorized';
    } catch {
      console.log('[Permissions] Windows Outlook not available or not accessible');
      return 'not-determined';
    }
  }

  return 'not-supported';
};

/**
 * Request calendar permission on macOS
 * On Windows, attempts to initialize Outlook COM object
 */
const requestCalendarPermission = async (): Promise<boolean> => {
  if (process.platform === 'darwin') {
    try {
      // On macOS, we trigger permission by trying to access Calendar
      // The system will show permission dialog if needed
      const { exec } = require('child_process');
      const util = require('util');
      const execAsync = util.promisify(exec);

      await execAsync(
        'osascript -l JavaScript -e \'Application("Calendar").calendars()[0].name()\'',
        { timeout: 10000 },
      );
      return true;
    } catch (error) {
      console.warn('[Permissions] Failed to request macOS calendar permission:', error);
      return false;
    }
  }

  if (process.platform === 'win32') {
    // Windows doesn't have a permission dialog for COM objects
    // We just check if Outlook is available
    const status = await checkCalendarPermission();
    return status === 'authorized';
  }

  return false;
};

// Configure Chromium switches before app readiness. Linux defaults to software rendering to avoid
// blank windows on incompatible Ubuntu GPU/Wayland combinations. This does not affect llama.cpp.
const rendererStartup = configureRendererStartup({
  platform: process.platform,
  env: process.env,
  commandLine: app.commandLine,
  disableHardwareAcceleration: () => app.disableHardwareAcceleration(),
});
if (isLinux && rendererStartup.softwareRenderingEnabled) {
  console.log(
    '[RendererStartup] software rendering is enabled; set ZHIYUAN_ENABLE_GPU=1 to opt in to GPU acceleration',
  );
}
if (enableVerboseLogging) {
  app.commandLine.appendSwitch('enable-logging');
  app.commandLine.appendSwitch('v', '1');
}

// Mild Chromium cache/GPU tweaks (ceiling flags like max-old-space-size are not used:
// they do not lower baseline RSS and can OOM heavy chat/document sessions).
app.commandLine.appendSwitch('disable-gpu-memory-buffer-videos');
app.commandLine.appendSwitch('disk-cache-size', String(50 * 1024 * 1024)); // 50MB

// 配置网络服务
app.on('ready', () => {
  agentResourceDiagnostics.setElectronMetricsProvider(() => app.getAppMetrics());
  // 配置网络服务重启策略
  app.configureHostResolver({
    enableBuiltInResolver: true,
    secureDnsMode: 'off',
  });
});

// 添加错误处理
app.on('render-process-gone', (_event, webContents, details) => {
  console.error('[RendererProcess] Render process exited:', details);
  agentResourceDiagnostics.logRendererProcessGone(details.reason);
  if (shouldReloadRendererProcess(details.reason, isQuitting)) {
    scheduleReload(`render-process-gone (${details.reason})`, webContents);
  }
});

app.on('child-process-gone', (_event, details) => {
  console.error('Child process gone:', details);
  if (reloadOnChildProcessGone && (details.type === 'GPU' || details.type === 'Utility')) {
    scheduleReload(`child-process-gone (${details.type}/${details.reason})`);
  }
});

// 终端或父进程先于应用消失时 stdout/stderr 管道会断开，之后的写入以 EPIPE 异步抛错。
// 先吞掉这类断管道错误，否则它会被升级成未捕获异常，而兜底处理器又通过
// console.error 写同一个断掉的管道，形成死循环并让进程永远不退。
installStdioErrorGuards([process.stdout, process.stderr], error => {
  log.error('[Main] stdio write failed:', error);
});

// 处理未捕获的异常
process.on(
  'uncaughtException',
  createUncaughtReporter(error => {
    console.error('Uncaught Exception:', error);
  }),
);

process.on(
  'unhandledRejection',
  createUncaughtReporter(error => {
    console.error('Unhandled Rejection:', error);
  }),
);

process.on('exit', code => {
  console.log(`[Main] Process exiting with code: ${code}`);
});

let store: SqliteStore | null = null;
let coworkStore: CoworkStore | null = null;
let piRuntimeAdapter: PiRuntimeAdapter | null = null;
let magpieManager: MagpieManager | undefined;
let managedMagpieBindings: ManagedMagpieProviderBindings | undefined;
let disposeMagpieModels: (() => void) | undefined;
let codingRoomService: CodingRoomService | null = null;
let todoReminderScheduler: TodoReminderScheduler | null = null;

/**
 * Refresh installed expert command choices after agent edits.
 */
let codingCommandCatalogGeneration = 0;
const bumpCodingCommandCatalog = (): void => {
  codingCommandCatalogGeneration += 1;
};

const getCodingRoomService = (): CodingRoomService => {
  if (!codingRoomService) {
    const runtime = getPiRuntimeAdapter();
    codingRoomService = new CodingRoomService(
      new CodingRoomRepository(getStore().getDatabase()),
      new CodingAgentRegistry(
        new CodingAgentProfileRepository(getStore().getDatabase()),
        () => Boolean(getStore().get<string>('magpie_default_model_id')),
        app.isPackaged
          ? path.join(process.resourcesPath, 'acp', 'registry.json')
          : path.join(process.cwd(), 'resources', 'acp', 'registry.json'),
        resolveAcpAdapterRoot({
          isPackaged: app.isPackaged,
          resourcesPath: process.resourcesPath,
          appPath: app.getAppPath(),
        }),
      ),
      {
        startBuiltinSession: async ({
          sessionId,
          workspaceRoot,
          prompt,
          modelOverride,
          thinkingLevel,
          permissionMode,
          expertIds,
        }) => {
          const approvalMode =
            permissionMode === ToolApprovalMode.Auto || permissionMode === ToolApprovalMode.AllowAll
              ? permissionMode
              : ToolApprovalMode.Ask;
          const coworkStoreInstance = getCoworkStore();
          if (!coworkStoreInstance.getSession(sessionId)) {
            coworkStoreInstance.createSession(
              t('coworkDefaultSessionTitle'),
              workspaceRoot,
              '',
              'local',
              [],
              'main',
              '',
              'work',
              sessionId,
            );
          }
          const expertSelection = expertIds
            ? resolveCodingExpertSelection({
                expertIds,
                resolveSnapshots: resolveSessionExpertSnapshots,
              })
            : null;
          // Resolving comes first: a stale expert id throws. Pi's agent_start
          // event is the single source of truth for the running state.
          const sharedOptions = {
            workspaceRoot,
            sessionMode: 'work' as const,
            approvalMode,
            ...(modelOverride ? { modelOverride } : {}),
            ...(thinkingLevel ? { thinkingLevel: thinkingLevel as PiThinkingLevel } : {}),
            ...(expertSelection
              ? { expertIds: expertSelection.expertIds, systemPrompt: expertSelection.systemPrompt }
              : {}),
          };
          // One lane keeps one Pi transcript: reusing the live session preserves
          // the earlier turns that startSession would discard.
          if (runtime.isSessionActive(sessionId)) {
            await runtime.continueSession(sessionId, prompt, {
              ...sharedOptions,
              _skipUserMessage: true,
            });
            return;
          }
          await runtime.startSession(sessionId, prompt, {
            ...sharedOptions,
            confirmationMode: 'modal',
            skipInitialUserMessage: true,
          });
        },
        setBuiltinApprovalMode: (sessionId, mode) =>
          runtime.setApprovalModeForSession(sessionId, mode),
        patchBuiltinSession: (sessionId, patch) =>
          runtime.patchSession(sessionId, {
            model: patch.model,
            thinkingLevel: patch.thinkingLevel as PiThinkingLevel | null | undefined,
          }),
        cancelBuiltinSession: async sessionId => runtime.stopSession(sessionId),
        commandCatalogGeneration: () => codingCommandCatalogGeneration,
        listCommandChoices: () => ({
          experts: getAgentManager()
            .listAgents()
            .filter(
              agent =>
                agent.source === CoworkSessionExpertSource.Package ||
                agent.source === CoworkSessionExpertSource.Member,
            )
            .map(agent => ({
              id: agent.id,
              name: agent.name,
              description: agent.description,
            })),
        }),
        compactBuiltinSession: sessionId => runtime.compactSession(sessionId),
        enqueueBuiltinControlAction: (sessionId, action) =>
          runtime.enqueueControlAction(sessionId, action),
        isBuiltinSessionRunning: sessionId => runtime.isSessionRunning(sessionId),
        isBuiltinSessionActive: sessionId => runtime.isSessionActive(sessionId),
        enqueueBuiltinMessage: (sessionId, prompt) =>
          runtime.enqueuePendingMessage(sessionId, prompt),
        steerBuiltinMessage: async (sessionId, prompt) => {
          const queued = await runtime.enqueuePendingMessage(sessionId, prompt);
          if (!queued.success || !queued.item) return queued;
          return await runtime.steerPendingMessage(sessionId, queued.item.id);
        },
        respondBuiltinPermission: (requestId, approved) =>
          runtime.respondToPermission(
            requestId,
            approved
              ? { behavior: 'allow' }
              : { behavior: 'deny', message: 'The user denied this coding permission.' },
          ),
        validateBuiltinModel: async () => {
          const probe = await probeCoworkModelReadiness();
          if (probe.ok === false) throw new Error(probe.error);
        },
        createIsolatedWorkspace: async ({ workspaceRoot, laneId, baseline }) => {
          const service = new GitWorktreeService(
            path.join(app.getPath('userData'), 'coding-worktrees'),
          );
          return await service.create({ repositoryRoot: workspaceRoot, laneId, baseline });
        },
        getWorkspaceBaseline: async workspaceRoot => {
          try {
            return await GitWorktreeService.getBaseline(workspaceRoot);
          } catch {
            return null;
          }
        },
        getWorkspaceDiff: async workspaceRoot =>
          await new GitWorktreeService(
            path.join(app.getPath('userData'), 'coding-worktrees'),
          ).getWorktreeDiffPreview(workspaceRoot),
        applyWorkspacePatch: async ({ workspaceRoot, patch }) =>
          await new GitWorktreeService(
            path.join(app.getPath('userData'), 'coding-worktrees'),
          ).applyPatch(workspaceRoot, patch),
        getIsolatedWorkspaceDiff: async workspaceRoot =>
          await new GitWorktreeService(
            path.join(app.getPath('userData'), 'coding-worktrees'),
          ).getWorktreeDiffPreview(workspaceRoot),
        applyIsolatedWorkspaceDiff: async ({ workspaceRoot, isolatedWorkspaceRoot }) =>
          await new GitWorktreeService(
            path.join(app.getPath('userData'), 'coding-worktrees'),
          ).applyWorktreeDiff({
            repositoryRoot: workspaceRoot,
            worktreeRoot: isolatedWorkspaceRoot,
          }),
      },
      {
        // The bundled Claude ACP adapter writes its own full exception details
        // here. This is intentionally app-owned and never includes credentials.
        CLAUDE_AGENT_LOGS: path.join(app.getPath('userData'), 'acp-logs', 'claude'),
        CLAUDE_CODE_DIAGNOSTICS_FILE: path.join(
          app.getPath('userData'),
          'acp-logs',
          'claude',
          'sdk-diagnostics.jsonl',
        ),
      },
    );
    codingRoomService.registry.hydrate();
    bindBuiltinCodingRuntime(runtime, (sessionId, kind, payload) => {
      codingRoomService?.recordBuiltinEvent(sessionId, kind, payload);
    });
  }
  return codingRoomService;
};

const getPiRuntimeAdapter = (): PiRuntimeAdapter => {
  if (!piRuntimeAdapter) {
    piRuntimeAdapter = new PiRuntimeAdapter();
    piRuntimeAdapter.setCoworkStore(getCoworkStore());
  }
  return piRuntimeAdapter;
};
let canonicalScheduledTaskService: CanonicalScheduledTaskService | null = null;
let activityService: ActivityService | null = null;
let canonicalSchedulerRuntime: LocalSchedulerRuntime | null = null;
/**
 * Pushes canonical scheduler Run/status changes to every renderer window.
 * Scheduled runs are started by the host clock, so without this push the
 * task list and run history would keep showing pre-Run state until the next
 * user action.
 */
const broadcastScheduledTaskEvent = (
  channel: (typeof ScheduledTaskIpc)[keyof typeof ScheduledTaskIpc],
  data: Record<string, unknown>,
): void => {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    try {
      win.webContents.send(channel, data);
    } catch (error) {
      console.error('[Scheduler] failed to broadcast a scheduled task event:', error);
    }
  }
};

const getCanonicalScheduledTaskService = (): CanonicalScheduledTaskService => {
  if (!canonicalScheduledTaskService) {
    const taskStore = new SqliteScheduledTaskStore(getStore().getDatabase());
    const executor = new PiScheduledTaskExecutor(
      getPiRuntimeAdapter(),
      getCoworkStore(),
      (runId, sessionId) => taskStore.setRunSession(runId, sessionId),
    );
    activityService ??= new ActivityService(getStore().getDatabase());
    canonicalSchedulerRuntime = new LocalSchedulerRuntime(
      taskStore,
      executor.execute.bind(executor),
      activityService,
      {
        runUpdated: (run, taskName) =>
          broadcastScheduledTaskEvent(ScheduledTaskIpc.RunUpdate, {
            run: { ...run, taskName },
          }),
        taskStateChanged: (taskId, state) =>
          broadcastScheduledTaskEvent(ScheduledTaskIpc.StatusUpdate, { taskId, state }),
      },
      run => executor.cancel(run),
      run =>
        !restoredNativeGuard?.has(run.sessionId ?? '') &&
        !restoredNativeGuard?.has(`scheduled-run:${run.id}`),
    );
    canonicalScheduledTaskService = new CanonicalScheduledTaskService(
      taskStore,
      canonicalSchedulerRuntime,
    );
  }
  return canonicalScheduledTaskService;
};
let storeInitPromise: Promise<SqliteStore> | null = null;
let sqliteBackupManager: SqliteBackupManager | null = null;

let llamaCppManager: LlamaCppManager | null = null;
let llamaCppModelDaemonController: LlamaCppModelDaemonController | null = null;
let ollamaManager: OllamaManager | null = null;

let piWorkbenchRuntimeForwarderBound = false;
let preventSleepBlockerId: number | null = null;
let appUpdateCoordinator: AppUpdateCoordinator | null = null;

function setPreventSleepBlockerEnabled(enabled: boolean): void {
  if (enabled) {
    if (preventSleepBlockerId === null || !powerSaveBlocker.isStarted(preventSleepBlockerId)) {
      preventSleepBlockerId = powerSaveBlocker.start(PowerSaveBlockerType.PreventAppSuspension);
    }
    return;
  }

  if (preventSleepBlockerId !== null && powerSaveBlocker.isStarted(preventSleepBlockerId)) {
    powerSaveBlocker.stop(preventSleepBlockerId);
  }
  preventSleepBlockerId = null;
}

const initStore = async (): Promise<SqliteStore> => {
  if (!storeInitPromise) {
    if (!app.isReady()) {
      throw new Error('Store accessed before app is ready.');
    }
    // better-sqlite3 opens the database synchronously, so Promise.resolve() resolves
    // immediately. The timeout acts as a safety net for unexpected OS-level
    // blocking during store initialization and recovery.
    storeInitPromise = Promise.race([
      SqliteStore.create(app.getPath('userData')),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Store initialization timed out after 15s')), 15_000),
      ),
    ]);
  }
  return storeInitPromise;
};

const getStore = (): SqliteStore => {
  if (!store) {
    throw new Error('Store not initialized. Call initStore() first.');
  }
  return store;
};

const getLlamaCppManager = (): LlamaCppManager => {
  if (!llamaCppManager) {
    llamaCppManager = new LlamaCppManager(() => getLlamaCppServiceConfig(getStore()));
  }
  return llamaCppManager;
};

const getOllamaManager = (): OllamaManager => {
  if (!ollamaManager) {
    ollamaManager = new OllamaManager(() => getOllamaServiceConfig(getStore()));
  }
  return ollamaManager;
};

const getAppUpdateCoordinator = (): AppUpdateCoordinator => {
  if (!appUpdateCoordinator) {
    appUpdateCoordinator = new AppUpdateCoordinator(getStore(), undefined, undefined, {
      enterpriseBuild: isEnterprise,
    });
  }
  return appUpdateCoordinator;
};

let appUpdatePollTimer: NodeJS.Timeout | null = null;
let lastSuccessfulAppUpdateCheckAt = 0;

const checkForAppUpdate = (): void => {
  void getAppUpdateCoordinator()
    .checkNow()
    .then(result => {
      if (result.success) lastSuccessfulAppUpdateCheckAt = Date.now();
    });
};

const startAppUpdatePolling = (): void => {
  // Enterprise builds receive updates through the enterprise distribution
  // channel; the client never runs startup or periodic update checks.
  if (isEnterprise || appUpdatePollTimer) return;
  const startupDelay =
    APP_UPDATE_STARTUP_DELAY_MIN_MS +
    Math.floor(Math.random() * APP_UPDATE_STARTUP_DELAY_JITTER_MS);
  setTimeout(checkForAppUpdate, startupDelay);
  appUpdatePollTimer = setInterval(checkForAppUpdate, APP_UPDATE_POLL_INTERVAL_MS);
};

const getCoworkStore = () => {
  if (!coworkStore) {
    const sqliteStore = getStore();
    coworkStore = new CoworkStore(sqliteStore.getDatabase());
  }
  return coworkStore;
};

let agentManager: AgentManager | null = null;
const getAgentManager = () => {
  if (!agentManager) {
    agentManager = new AgentManager(getCoworkStore());
  }
  return agentManager;
};

const resolveSessionWorkingDirectory = (options: { cwd?: string }): string => {
  const explicitWorkingDirectory = options.cwd?.trim();
  if (explicitWorkingDirectory) return explicitWorkingDirectory;
  return getCoworkStore().getConfig().workingDirectory.trim();
};

// Deferred gateway restart: when a config change requires a gateway restart
// but active cowork sessions or cron jobs exist, we defer the restart until
// all workloads complete.  A polling interval checks periodically; a hard
// timeout ensures the restart eventually happens even if a session hangs.

// 5 minutes hard cap

// Debounce state for channel account reconciliation.
// Merges rapid successive calls within a 500ms window to avoid redundant
// config writes and restart evaluations.  Only the *last* call's options
// are used for the debounced execution (except restartGatewayIfRunning,
// which is OR-merged so no request is silently dropped).

/** Project Pi Work/Chat events to renderer-owned cowork streams. */
const forwardPiWorkbenchRuntimeToRenderer = (runtime: PiRuntimeAdapter): void => {
  const sequencer = new PiUiEventSequencer(() => crypto.randomUUID());
  const runtimeSnapshots = new PiUiRuntimeSnapshots();
  ipcMain.handle(CoworkStreamIpc.RuntimeSnapshots, (_event, sessionId?: string) =>
    runtimeSnapshots.read(sessionId),
  );
  const broadcastUiEvent = (event: PiUiEvent): void => {
    runtimeSnapshots.observe(event);
    historyService?.invalidate();
    const windows = BrowserWindow.getAllWindows();
    windows.forEach(win => {
      if (win.isDestroyed()) return;
      try {
        win.webContents.send(CoworkStreamIpc.UiEvent, event);
      } catch (error) {
        console.error('[PiWorkbenchForwarder] failed to forward a Pi UI event:', error);
      }
    });
    const workEvent = mapPiUiEventToWorkEvent(event);
    if (workEvent) broadcastTaskBoardWorkEvent(workEvent);
  };
  const emitUiEvent = createPiUiEventBatcher((payload: PiUiEventPayload) => {
    broadcastUiEvent(sequencer.next(payload));
  });

  const contentProjection = bindCoworkContentBridge(
    runtime,
    () => getStore().getDatabase(),
    patch => emitUiEvent({ type: PiUiEventType.ContentPatch, sessionId: patch.sessionId, patch }),
  );

  runtime.on('started', (sessionId: string) => {
    emitUiEvent({ type: PiUiEventType.Started, sessionId });
  });

  runtime.on('message', (sessionId: string, message: unknown) => {
    const safeMessage = sanitizeCoworkMessageForIpc(message);
    emitUiEvent({
      type: PiUiEventType.Message,
      sessionId,
      message: safeMessage as PiUiMessage,
    });
  });

  runtime.on(
    'messageUpdate',
    (sessionId: string, messageId: string, content: string, metadata?: Record<string, unknown>) => {
      void contentProjection
        .project(sessionId, messageId, content, metadata)
        .then(patches => {
          for (const patch of patches)
            emitUiEvent({ type: PiUiEventType.ContentPatch, sessionId, patch });
        })
        .catch(error => console.error('[PiWorkbenchForwarder] content projection failed:', error));
    },
  );

  runtime.on('queueUpdated', (sessionId, items) => {
    const safeItems = slimQueuedMessagesForIpc(items);
    emitUiEvent({ type: PiUiEventType.QueueUpdated, sessionId, items: safeItems });
  });

  runtime.on('permissionRequest', (sessionId: string, request: unknown) => {
    if (runtime.getSessionConfirmationMode(sessionId) === 'text') {
      return;
    }
    const safeRequest = sanitizePermissionRequestForIpc(request);
    if (!safeRequest || typeof safeRequest !== 'object') return;
    const requestRecord = safeRequest as Record<string, unknown>;
    if (typeof requestRecord.requestId !== 'string' || typeof requestRecord.toolName !== 'string') {
      console.warn('[PiWorkbenchForwarder] ignored a malformed permission request');
      return;
    }
    const toolInput =
      requestRecord.toolInput && typeof requestRecord.toolInput === 'object'
        ? (requestRecord.toolInput as Record<string, unknown>)
        : {};
    emitUiEvent({
      type: PiUiEventType.PermissionRequest,
      sessionId,
      request: {
        requestId: requestRecord.requestId,
        toolName: requestRecord.toolName,
        toolInput,
        ...(typeof requestRecord.toolUseId === 'string'
          ? { toolUseId: requestRecord.toolUseId }
          : {}),
      },
    });
  });

  runtime.on('workDocumentChanged', payload => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send('cowork:workDocument:changed', payload);
    }
  });

  runtime.on('permissionDismiss', (requestId: string) => {
    emitUiEvent({ type: PiUiEventType.PermissionDismiss, sessionId: null, requestId });
  });

  runtime.on('nativeRetry', (sessionId, notice) => {
    const payload: RuntimeRetryNotice = { sessionId, ...notice };
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(RuntimeNoticeIpc.Notice, payload);
    }
  });

  runtime.on('sessionStopped', (sessionId: string) => {
    emitUiEvent({ type: PiUiEventType.Stopped, sessionId });
  });

  runtime.on('complete', (sessionId: string) => {
    emitUiEvent({
      type: PiUiEventType.Completed,
      sessionId,
    });
  });

  runtime.on('error', (sessionId: string, error: import('../common/coworkError').CoworkError) => {
    try {
      persistCoworkTerminalError(
        getStore().getDatabase(),
        getCoworkStore(),
        sessionId,
        error,
        message => runtime.emit('message', sessionId, message),
      );
    } catch (persistenceError) {
      console.error(
        `[PiWorkbenchForwarder] failed to persist an error for session ${sessionId}:`,
        persistenceError,
      );
    }
    // Persisting the terminal message emits the canonical `message` event
    // first. The UI protocol keeps that ordering before the terminal error.
    emitUiEvent({ type: PiUiEventType.Error, sessionId, error });
  });
};

const bindPiWorkbenchRuntimeForwarder = (): void => {
  if (piWorkbenchRuntimeForwarderBound) return;

  forwardPiWorkbenchRuntimeToRenderer(getPiRuntimeAdapter());
  piWorkbenchRuntimeForwarderBound = true;
};

const resolveCoworkPromptLanguage = (): CoworkPromptLanguage => {
  const configuredLanguage = getStore().get<AppConfigSettings>('app_config')?.language;
  return configuredLanguage === 'en' ? 'en' : 'zh';
};

const haveSameExpertSnapshots = (
  left: CoworkSessionExpertSnapshot[],
  right: CoworkSessionExpertInput[],
): boolean =>
  left.length === right.length &&
  left.every(
    (expert, index) =>
      expert.expertId === right[index]?.expertId &&
      expert.contentHash === right[index]?.contentHash,
  );

const haveSameExpertIds = (
  experts: CoworkSessionExpertSnapshot[],
  requestedExpertIds: string[],
): boolean => {
  const normalizedIds = normalizeSingleExpertIds(requestedExpertIds);
  return (
    experts.length === normalizedIds.length &&
    experts.every((expert, index) => expert.expertId === normalizedIds[index])
  );
};

const resolveSessionExpertSnapshots = (expertIds: string[]): CoworkSessionExpertInput[] => {
  const normalizedExpertIds = normalizeSingleExpertIds(expertIds);
  const snapshots: CoworkSessionExpertInput[] = [];
  for (const expertId of normalizedExpertIds) {
    const expert = getAgentManager().getAgent(expertId);
    if (
      !expert ||
      (expert.source !== CoworkSessionExpertSource.Package &&
        expert.source !== CoworkSessionExpertSource.Member)
    ) {
      throw new Error(`Expert '${expertId}' is not installed or is not an expert package agent`);
    }
    const promptSnapshot = expert.systemPrompt.trim();
    const packageId = expert.presetId.trim() || expert.id;
    const skillIds: string[] = [];

    if (!promptSnapshot) {
      throw new Error(`Expert '${expertId}' has an empty system prompt`);
    }
    const contentHash = crypto
      .createHash('sha256')
      .update(JSON.stringify({ packageId, expertId: expert.id, promptSnapshot, skillIds }))
      .digest('hex');
    snapshots.push({
      expertId: expert.id,
      packageId,
      expertName: expert.name,
      source: expert.source,
      promptSnapshot,
      skillIds,
      capabilityPolicy: {},
      contentHash,
    });
  }
  return snapshots;
};

// 获取正确的预加载脚本路径
const PRELOAD_PATH = app.isPackaged
  ? path.join(__dirname, 'preload.js')
  : path.join(__dirname, '../dist-electron/preload.js');

// 获取应用图标路径（与安装包/桌面快捷方式保持一致，不复用系统托盘图标）
const getAppIconPath = (): string | undefined => {
  if (process.platform !== 'win32' && process.platform !== 'linux') return undefined;
  if (app.isPackaged) {
    const packagedIconName = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
    return path.join(process.resourcesPath, 'app-icons', packagedIconName);
  }

  // 2026/09/21 lixiang  开发态优先用 ico：任务栏按 Windows Shell 取图标，png 常仍显示 Electron 原子图。
  if (process.platform === 'win32') {
    const icoPath = path.join(__dirname, '..', 'build', 'icons', 'win', 'icon.ico');
    if (fs.existsSync(icoPath)) return icoPath;
    const pngPath = path.join(__dirname, '..', 'build', 'icons', 'png', '256x256.png');
    if (fs.existsSync(pngPath)) return pngPath;
    return undefined;
  }
  return path.join(__dirname, '..', 'build', 'icons', 'png', '256x256.png');
};

const applyWindowsWindowIcon = (window: BrowserWindow): void => {
  if (process.platform !== 'win32') return;
  const iconPath = getAppIconPath();
  if (!iconPath || !fs.existsSync(iconPath)) {
    console.warn('[Main] Windows app icon file is missing:', iconPath);
    return;
  }
  // Prefer path string — Electron updates both window and taskbar icons from it.
  window.setIcon(iconPath);
  console.log('[Main] Applied Windows window icon:', iconPath);
};

/**
 * Windows 任务栏：开发态必须有一条「相同 AUMID + 知远 .ico」的开始菜单快捷方式。
 * 文件名只用 ASCII，避免控制台/文件系统编码把「知远 (开发).lnk」写成乱码后对不上。
 */
const ensureWindowsTaskbarBrand = (): void => {
  if (process.platform !== 'win32' || app.isPackaged) return;
  const iconPath = path.join(__dirname, '..', 'build', 'icons', 'win', 'icon.ico');
  if (!fs.existsSync(iconPath)) {
    console.warn('[Main] 知远 logo 不存在，无法绑定任务栏图标:', iconPath);
    return;
  }
  const programsDir = path.join(
    app.getPath('appData'),
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
  );
  fs.mkdirSync(programsDir, { recursive: true });
  const shortcutPath = path.join(programsDir, 'ZhiYuan-Dev.lnk');
  try {
    // 清掉历史上编码损坏的中文快捷方式名，避免 Shell 继续命中坏缓存。
    for (const name of fs.readdirSync(programsDir)) {
      if (!name.endsWith('.lnk')) continue;
      if (name === 'ZhiYuan-Dev.lnk') continue;
      if (name.includes('开发') || name.includes('知远') || /ZhiYuan|zhiyuan/i.test(name)) {
        try {
          fs.unlinkSync(path.join(programsDir, name));
        } catch {
          /* ignore */
        }
      }
    }
    // create：文件不存在时 replace 会失败且不抛错，快捷方式实际没写上，任务栏继续用原子图标缓存。
    const wrote = shell.writeShortcutLink(shortcutPath, 'create', {
      target: process.execPath,
      args: process.argv.slice(1).join(' '),
      cwd: process.cwd(),
      appUserModelId: WINDOWS_TASKBAR_APP_USER_MODEL_ID,
      icon: iconPath,
      iconIndex: 0,
      description: runtimeAppName,
    });
    if (!wrote || !fs.existsSync(shortcutPath)) {
      console.warn('[Main] Failed to write Windows taskbar brand shortcut:', shortcutPath);
      return;
    }
    console.log('[Main] Windows taskbar brand shortcut ready:', shortcutPath, iconPath);
  } catch (error) {
    console.warn('[Main] Failed to write Windows taskbar brand shortcut:', error);
  }
};

// 保存对主窗口的引用
let mainWindow: BrowserWindow | null = null;
let historyService: ReturnType<typeof registerHistoryIpc> | undefined;
let historyIndexDb: Database.Database | undefined;
let restoredNativeGuard: Awaited<ReturnType<typeof loadRestoredNativeGuard>> | undefined;
let disposeMagpie: (() => Promise<void>) | undefined;

let isQuitting = false;

let lastReloadAt = 0;
let windowStateSaveTimer: ReturnType<typeof setTimeout> | null = null;
const MIN_RELOAD_INTERVAL_MS = 5000;
const WINDOW_STATE_SAVE_DEBOUNCE_MS = 300;
type AppConfigSettings = {
  theme?: string;
  language?: string;
  useSystemProxy?: boolean;
  sqliteAutoBackupEnabled?: boolean;
};

const getUseSystemProxyFromConfig = (config?: { useSystemProxy?: boolean }): boolean => {
  return config?.useSystemProxy === true;
};

const getSqliteAutoBackupEnabledFromConfig = (config?: {
  sqliteAutoBackupEnabled?: boolean;
}): boolean => {
  return config?.sqliteAutoBackupEnabled === true;
};

const resolveThemeFromConfig = (config?: AppConfigSettings): 'light' | 'dark' => {
  if (config?.theme === 'dark') {
    return 'dark';
  }
  if (config?.theme === 'light') {
    return 'light';
  }
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
};

const getInitialTheme = (): 'light' | 'dark' => {
  const config = getStore().get<AppConfigSettings>('app_config');
  return resolveThemeFromConfig(config);
};

const getTitleBarOverlayOptions = () => {
  const config = getStore().get<AppConfigSettings>('app_config');
  const theme = resolveThemeFromConfig(config);
  return {
    color: TITLEBAR_COLORS[theme].color,
    symbolColor: TITLEBAR_COLORS[theme].symbolColor,
    height: TITLEBAR_HEIGHT,
  };
};

const updateTitleBarOverlay = () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!isMac && !isWindows) {
    mainWindow.setTitleBarOverlay(getTitleBarOverlayOptions());
  }
  // Also update the window background color to match the theme
  const config = getStore().get<AppConfigSettings>('app_config');
  const theme = resolveThemeFromConfig(config);
  mainWindow.setBackgroundColor(theme === 'dark' ? '#0F1117' : '#F8F9FB');
};

const applyProxyPreference = async (useSystemProxy: boolean): Promise<void> => {
  setSystemProxyEnabled(useSystemProxy);

  try {
    await session.defaultSession.setProxy({ mode: useSystemProxy ? 'system' : 'direct' });
  } catch (error) {
    console.error('[Main] Failed to apply session proxy mode:', error);
  }

  if (!useSystemProxy) {
    restoreOriginalProxyEnv();
    console.log('[Main] System proxy disabled (direct mode).');
    return;
  }

  const { proxyUrl, targetUrl } = await resolveSystemProxyUrlForTargets();
  applySystemProxyEnv(proxyUrl);

  if (proxyUrl) {
    console.log(`[Main] System proxy enabled for process env via ${targetUrl}:`, proxyUrl);
  } else {
    console.warn('[Main] System proxy mode enabled, but no proxy endpoint was resolved (DIRECT).');
  }
};

const emitWindowState = () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.webContents.isDestroyed()) return;
  mainWindow.webContents.send('window:state-changed', {
    isMaximized: mainWindow.isMaximized(),
    isFullscreen: mainWindow.isFullScreen(),
    isFocused: mainWindow.isFocused(),
  });
};

const getDisplayWorkAreas = (): WindowRectangle[] => {
  return screen.getAllDisplays().map(display => display.workArea);
};

const getCurrentAppWindowState = () => {
  if (!mainWindow || mainWindow.isDestroyed()) return null;

  const bounds = mainWindow.isFullScreen()
    ? mainWindow.getNormalBounds()
    : mainWindow.isMaximized()
      ? mainWindow.getNormalBounds()
      : mainWindow.getBounds();

  return {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    isMaximized: mainWindow.isMaximized(),
  };
};

const persistAppWindowState = () => {
  const state = getCurrentAppWindowState();
  if (!state) return;
  getStore().set(AppWindowStoreKey.State, state);
};

const schedulePersistAppWindowState = () => {
  if (windowStateSaveTimer) {
    clearTimeout(windowStateSaveTimer);
  }

  windowStateSaveTimer = setTimeout(() => {
    windowStateSaveTimer = null;
    persistAppWindowState();
  }, WINDOW_STATE_SAVE_DEBOUNCE_MS);
};

const showSystemMenu = (position?: { x?: number; y?: number }) => {
  if (!isWindows) return;
  if (!mainWindow || mainWindow.isDestroyed()) return;

  const isMaximized = mainWindow.isMaximized();
  const menu = Menu.buildFromTemplate([
    { label: 'Restore', enabled: isMaximized, click: () => mainWindow.restore() },
    { role: 'minimize' },
    { label: 'Maximize', enabled: !isMaximized, click: () => mainWindow.maximize() },
    { type: 'separator' },
    { role: 'close' },
  ]);

  menu.popup({
    window: mainWindow,
    x: Math.max(0, Math.round(position?.x ?? 0)),
    y: Math.max(0, Math.round(position?.y ?? 0)),
  });
};

const scheduleReload = (reason: string, webContents?: WebContents) => {
  if (isQuitting) {
    console.debug(`[RendererProcess] Skipping reload during shutdown (${reason}).`);
    return;
  }
  const target = webContents ?? mainWindow?.webContents;
  if (!target || target.isDestroyed()) {
    return;
  }
  const now = Date.now();
  if (now - lastReloadAt < MIN_RELOAD_INTERVAL_MS) {
    console.warn(`Skipping reload (${reason}); last reload was ${now - lastReloadAt}ms ago.`);
    return;
  }
  lastReloadAt = now;
  console.warn(`Reloading window due to ${reason}`);
  target.reloadIgnoringCache();
};

// 确保应用程序只有一个实例
const gotTheLock = app.requestSingleInstanceLock();

/**
 * Linux only: 检测单实例锁被哪个"知远"实例持有。
 *
 * 返回 null 表示没有可接管的目标(同版本多开或未检测到),此时由第一实例
 * 的 second-instance 处理唤起已有窗口,本实例直接退出。
 * 返回 { pids, oldLabel } 表示存在"旧版本"实例,需要用户确认后接管。
 *
 * 身份判定:
 *  - AppImage:运行时环境变量 APPIMAGE 指向源文件(文件名含版本号),
 *    与当前进程的 APPIMAGE 不同即视为旧版本
 *  - deb:/opt/知远 下的进程无 APPIMAGE,exe 路径匹配即视为同族;
 *    无法区分版本,统一按"旧实例"提示确认
 */
async function findStaleLinuxInstances(): Promise<{
  pids: number[];
  oldLabel: string;
} | null> {
  if (process.platform !== 'linux') return null;

  const currentAppImage = process.env.APPIMAGE ?? null;
  const familyPattern = /知远|ZhiYuanAgent/i;

  const pids: number[] = [];
  const oldAppImages: string[] = [];
  let entries: string[];
  try {
    entries = fs.readdirSync('/proc');
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number(entry);
    if (pid === process.pid) continue;
    try {
      const env = fs.readFileSync(`/proc/${pid}/environ`, 'utf8');
      const appImage = env.match(/APPIMAGE=([^\0]*)/)?.[1] ?? null;
      if (appImage) {
        if (!familyPattern.test(appImage)) continue;
        // 同一版本文件的多开:唤起已有窗口即可,不接管
        if (currentAppImage && appImage === currentAppImage) continue;
        pids.push(pid);
        oldAppImages.push(appImage);
      } else {
        // 非 AppImage:匹配 deb 安装路径 /opt/知远
        const exe = fs.readlinkSync(`/proc/${pid}/exe`);
        if (!/\/opt\/知远/.test(exe)) continue;
        pids.push(pid);
      }
    } catch {
      // 权限不足或进程已退出,跳过
    }
  }
  if (pids.length === 0) return null;

  // 从 AppImage 文件名提取旧版本号,如 知远-1.0.0.AppImage → 1.0.0
  const versionMatch = oldAppImages[0]?.match(/-(\d+\.\d+\.\d+)\.AppImage/i);
  const oldLabel = versionMatch ? `知远 ${versionMatch[1]}` : '旧版本的知远';
  return { pids, oldLabel };
}

/** 终止指定进程并等待退出(最多 5 秒)。 */
async function terminatePids(pids: number[]): Promise<boolean> {
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // 已退出或无权,忽略
    }
  }
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const alive = pids.filter(pid => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    });
    if (alive.length === 0) return true;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  return false;
}

if (!gotTheLock) {
  void (async () => {
    // 同版本多开:第一实例已通过 second-instance 聚焦窗口,本实例直接退出。
    const stale = await findStaleLinuxInstances();
    if (stale) {
      // 旧版本实例(AppImage 替换):弹窗确认后再接管,避免中断用户正在进行
      // 的会话。确认后终止旧实例并 relaunch,让新进程重新拿锁启动。
      console.warn(
        `[Main] Detected running ${stale.oldLabel} instance (pid ${stale.pids.join(', ')}); asking user before takeover.`,
      );
      try {
        await app.whenReady();
        const currentVersion = app.getVersion();
        const { response } = await dialog.showMessageBox({
          type: 'question',
          buttons: ['关闭旧版本并启动新版本', '取消'],
          defaultId: 0,
          cancelId: 1,
          title: '检测到旧版本正在运行',
          message: `检测到 ${stale.oldLabel} 正在运行。`,
          detail:
            `当前启动的是知远 ${currentVersion}。启动新版本需要先关闭旧版本,` +
            '关闭旧版本将中断其中进行中的任务。是否继续?',
        });
        if (response === 1) {
          app.exit(0);
          return;
        }
      } catch {
        // 无显示环境(如无头 CI):无法确认,直接退出
        app.exit(0);
        return;
      }
      const terminated = await terminatePids(stale.pids);
      if (!terminated) {
        console.warn('[Main] Stale instance did not exit in time; giving up takeover.');
        app.exit(0);
        return;
      }
      app.relaunch();
      app.exit(0);
      return;
    }
    console.warn('[Main] Another ZhiYuanAgent instance is already running; exiting.');
    app.exit(0);
  })();
} else {
  // The enterprise build signs in inside the app and never claims zhiyuan://;
  // the community build owns it for its browser OAuth callback.
  registerZhiyuanDeepLinkProtocol(app, {
    isEnterpriseBuild: isEnterprise,
    isDefaultApp: process.defaultApp === true,
    entryPoint: process.argv[1],
    execPath: process.execPath,
  });

  let pendingCommunityLogin: { state: string; verifier: string; expiresAt: number } | null = null;

  type CommunityAuthPayload = Record<string, unknown>;

  async function readCommunityAuthPayload(
    response: Response,
  ): Promise<CommunityAuthPayload | null> {
    const rawText = await response.text();
    if (!rawText) return null;

    try {
      const payload: unknown = JSON.parse(rawText);
      return payload && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as CommunityAuthPayload)
        : null;
    } catch {
      return null;
    }
  }

  /** Parse a zhiyuan:// deep link for the pending community login. */
  const handleDeepLink = (url: string) => {
    try {
      const parsed = new URL(url);
      if (parsed.hostname === 'auth' && parsed.pathname === '/callback') {
        const code = parsed.searchParams.get('code');
        const state = parsed.searchParams.get('state');
        if (code && state && pendingCommunityLogin?.state === state) {
          void completeCommunityLogin(code, state);
          return;
        }
        console.warn('[CommunityAuth] Ignoring unexpected auth callback');
      }
    } catch (e) {
      console.error('[Main] Failed to parse deep link:', e);
    }
  };

  ipcMain.on('log:fromRenderer', (_event, level: string, tag: string, message: string) => {
    const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    fn(`[Renderer][${tag}] ${message}`);
  });

  // macOS: handle open-url event for deep links
  app.on('open-url', (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });

  app.on('second-instance', (_event, commandLine, workingDirectory) => {
    console.debug('[Main] second-instance event', { commandLine, workingDirectory });

    // Check for deep link in command line args (Windows/Linux)
    const deepLink = commandLine.find(arg => arg.startsWith('zhiyuan://'));
    if (deepLink) {
      handleDeepLink(deepLink);
    }

    // Focus main window
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      if (!mainWindow.isFocused()) mainWindow.focus();
    }
  });

  // IPC 处理程序
  ipcMain.handle('store:get', (_event, key) => {
    return key === 'app_config' ? projectAppPreferences(getStore().get(key)) : getStore().get(key);
  });

  ipcMain.handle('store:set', async (_event, key, value) => {
    if (isManagedModelPreference(key))
      throw new Error('Use model settings to change this preference');
    getStore().set(
      key,
      key === 'app_config' ? mergeAppPreferences(getStore().get(key), value) : value,
    );
  });

  ipcMain.handle('store:remove', (_event, key) => {
    if (isManagedModelPreference(key))
      throw new Error('Use model settings to change this preference');
    getStore().delete(key);
  });

  ipcMain.handle('enterprise:getConfig', async () => {
    try {
      return getStore().get('enterprise_config') ?? null;
    } catch {
      return null;
    }
  });
  ipcMain.handle(EnterpriseSessionIpc.Snapshot, () => zhiyuanEnterpriseSessionBridge.snapshot());
  ipcMain.handle(EnterpriseSessionIpc.Login, (_event, input: unknown) =>
    zhiyuanEnterpriseSessionBridge.login(input),
  );
  ipcMain.handle(EnterpriseSessionIpc.ChangePassword, (_event, input: unknown) =>
    zhiyuanEnterpriseSessionBridge.changePassword(input),
  );
  ipcMain.handle(EnterpriseSessionIpc.Logout, () => zhiyuanEnterpriseSessionBridge.logout());
  ipcMain.handle(EnterpriseRendererIpc.SessionGateEntrypoint, () =>
    zhiyuanEnterpriseRendererBridge.sessionGateEntrypoint(),
  );
  ipcMain.handle(EnterpriseRendererIpc.SettingsPages, () =>
    zhiyuanEnterpriseRendererBridge.settingsPages(),
  );
  ipcMain.handle(ManagedProviderIpc.Policy, () => zhiyuanManagedProviderBridge.accessPolicy());
  ipcMain.handle(ManagedProviderIpc.Catalog, () => zhiyuanManagedProviderBridge.catalog());
  zhiyuanManagedProviderBridge.onDidChange(() => {
    if (magpieManager?.status().state === 'running')
      void managedMagpieBindings
        ?.synchronize()
        .catch(error => console.error('[Magpie] Managed catalog sync failed', error));
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(ManagedProviderIpc.Changed);
    }
  });

  ipcMain.handle('hardware:nvidia-smi', async () => getNvidiaSmiSnapshot());
  ipcMain.handle(HardwareIpc.SystemMemory, async () => getSystemMemorySnapshot());

  // Network status change handler
  // Remove any existing listener first to avoid duplicate registrations
  ipcMain.removeAllListeners('network:status-change');
  ipcMain.on('network:status-change', (_event, status: 'online' | 'offline') => {
    console.log(`[Main] Network status changed: ${status}`);
  });

  // Log IPC handlers
  ipcMain.handle('log:getPath', () => {
    return getLogFilePath();
  });

  ipcMain.handle('log:openFolder', () => {
    const logPath = getLogFilePath();
    if (logPath) {
      shell.showItemInFolder(logPath);
    }
  });

  ipcMain.handle('log:exportZip', async event => {
    try {
      const ownerWindow = BrowserWindow.fromWebContents(event.sender);
      if (!ownerWindow || ownerWindow.isDestroyed()) {
        return { success: false, error: 'Window is not available' };
      }

      const saveOptions = {
        title: 'Export Logs',
        defaultPath: path.join(app.getPath('downloads'), buildLogExportFileName()),
        filters: [{ name: 'Zip Archive', extensions: ['zip'] }],
      };

      const saveResult = await dialog.showSaveDialog(ownerWindow, saveOptions);

      if (saveResult.canceled || !saveResult.filePath) {
        return { success: true, canceled: true };
      }

      const outputPath = ensureZipFileName(saveResult.filePath);
      const archiveResult = await exportLogsZip({
        outputPath,
        entries: [
          ...getRecentMainLogEntries(),
          { archiveName: 'cowork.log', filePath: getCoworkLogPath() },
          ...(process.platform === 'win32'
            ? [
                {
                  archiveName: 'install-timing.log',
                  filePath: path.join(
                    app.getPath('appData'),
                    APP_DATA_DIR_NAME,
                    'install-timing.log',
                  ),
                },
              ]
            : []),
        ],
      });

      return {
        success: true,
        canceled: false,
        path: outputPath,
        missingEntries: archiveResult.missingEntries,
      };
    } catch (error) {
      console.error('[LogExport] export failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to export logs',
      };
    }
  });

  // Auto-launch IPC handlers
  // Use SQLite store as the source of truth for UI state, because
  // app.getLoginItemSettings() returns unreliable values on macOS and
  // requires matching args on Windows.
  ipcMain.handle('app:getAutoLaunch', () => {
    const stored = getStore().get<boolean>('auto_launch_enabled');
    // Fall back to OS API if SQLite has no record yet (e.g. upgraded from older version)
    const enabled = stored ?? getAutoLaunchEnabled();
    return { enabled };
  });

  ipcMain.handle('app:setAutoLaunch', (_event, enabled: unknown) => {
    if (typeof enabled !== 'boolean') {
      return { success: false, error: 'Invalid parameter: enabled must be boolean' };
    }
    try {
      setAutoLaunchEnabled(enabled);
      getStore().set('auto_launch_enabled', enabled);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to set auto-launch',
      };
    }
  });

  ipcMain.handle('app:getPreventSleep', () => {
    const enabled = getStore().get<boolean>('prevent_sleep_enabled') ?? false;
    return { enabled };
  });

  ipcMain.handle('app:setPreventSleep', (_event, enabled: unknown) => {
    if (typeof enabled !== 'boolean') {
      return { success: false, error: 'Invalid parameter: enabled must be boolean' };
    }
    try {
      setPreventSleepBlockerEnabled(enabled);
      getStore().set('prevent_sleep_enabled', enabled);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to set prevent-sleep',
      };
    }
  });

  ipcMain.handle('app:relaunch', () => {
    console.log('[Main] app:relaunch requested, scheduling restart...');
    recordAppQuitOrigin(AppQuitOrigin.RendererRelaunch);
    app.relaunch();
    app.quit();
  });

  // Window control IPC handlers
  ipcMain.on('window-minimize', () => {
    mainWindow?.minimize();
  });

  ipcMain.on('window-maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });

  ipcMain.on('window-close', () => {
    mainWindow?.close();
  });

  ipcMain.handle('window:isMaximized', () => {
    return mainWindow?.isMaximized() ?? false;
  });

  ipcMain.on(
    'window:showSystemMenu',
    (_event, position: { x?: number; y?: number } | undefined) => {
      showSystemMenu(position);
    },
  );
  /** 2026/09/14 lisa  打开开发调试面板 **/

  const canUseDevTools = () => isDev || !app.isPackaged;
  const openDevToolsWindow = (webContents: WebContents) => {
    // Docked mode is more discoverable than a detached window that can open
    // off-screen on multi-monitor Windows setups.
    webContents.openDevTools({ mode: 'right', activate: true });
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
  };
  const toggleDevToolsForSender = (webContents?: WebContents | null) => {
    if (!canUseDevTools()) return false;
    const target =
      webContents && !webContents.isDestroyed() ? webContents : mainWindow?.webContents;
    if (!target || target.isDestroyed()) return false;
    if (target.isDevToolsOpened()) target.closeDevTools();
    else openDevToolsWindow(target);
    return true;
  };
  ipcMain.handle(WindowIpc.ToggleDevTools, event => toggleDevToolsForSender(event.sender));
  ipcMain.handle(WindowIpc.OpenDevTools, event => {
    if (!canUseDevTools()) return false;
    const target = event.sender?.isDestroyed?.() ? mainWindow?.webContents : event.sender;
    if (!target || target.isDestroyed()) return false;
    openDevToolsWindow(target);
    return true;
  });

  ipcMain.handle(AppIpc.GetVersion, () => app.getVersion());
  ipcMain.handle(AppIpc.IsDev, () => canUseDevTools()); // 开发环境打开调试面板
  ipcMain.handle(AppIpc.IsEnterprise, () => isEnterprise);
  ipcMain.handle(AppIpc.GetSystemLocale, () => app.getLocale());
  ipcMain.handle(AppIpc.ConsumePendingLocalInferenceInstall, () =>
    consumePendingLocalInferenceInstall(app.getPath('userData')),
  );

  // ── Community auth IPC handlers ──
  const communityAuthSession = configureCommunityAuthSession(getStore);
  registerModelPoolIpcHandlers(communityAuthSession);

  ipcMain.handle(CommunityAuthIpc.GetCommunityUser, async () => {
    const user = communityAuthSession.getUser();
    if (!user) return { success: false };
    try {
      await communityAuthSession.getAccessToken();
      return { success: true, user };
    } catch {
      return { success: false };
    }
  });

  ipcMain.handle(CommunityAuthIpc.Logout, () => {
    communityAuthSession.clear();
    return { success: true };
  });

  async function completeCommunityLogin(code: string, state: string): Promise<void> {
    const pending = pendingCommunityLogin;
    pendingCommunityLogin = null;
    if (!pending || pending.state !== state || pending.expiresAt < Date.now()) return;
    try {
      const response = await net.fetch(`${COMMUNITY_AUTH_ORIGIN}/v1/auth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          code,
          code_verifier: pending.verifier,
          redirect_uri: 'zhiyuan://auth/callback',
        }),
      });
      const payload = await readCommunityAuthPayload(response);
      if (!response.ok) {
        console.warn(
          `[CommunityAuth] token exchange returned an invalid response with status ${response.status}`,
        );
        throw new Error('Token exchange failed');
      }
      const user = communityAuthSession.saveTokenPayload(payload);
      mainWindow?.webContents.send(CommunityAuthIpc.Callback, {
        success: true,
        user: { id: user.id, email: user.email, name: user.email },
      });
      if (mainWindow?.isMinimized()) mainWindow.restore();
      if (mainWindow && !mainWindow.isVisible()) mainWindow.show();
      mainWindow?.focus();
    } catch (error) {
      console.warn(
        '[CommunityAuth] login callback failed:',
        error instanceof Error ? error.message : error,
      );
      mainWindow?.webContents.send(CommunityAuthIpc.Callback, {
        success: false,
        error: t('communityAuthLoginIncomplete'),
      });
    }
  }

  ipcMain.handle(CommunityAuthIpc.Login, async () => {
    try {
      if (!communityAuthSession.canPersist()) {
        return { success: false, error: '系统安全存储不可用，无法安全地保存登录状态。' };
      }
      const verifier = crypto.randomBytes(48).toString('base64url');
      const state = crypto.randomBytes(32).toString('base64url');
      const codeChallenge = crypto.createHash('sha256').update(verifier).digest('base64url');
      const response = await net.fetch(`${COMMUNITY_AUTH_ORIGIN}/v1/auth/authorize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          redirect_uri: 'zhiyuan://auth/callback',
          state,
          code_challenge: codeChallenge,
          code_challenge_method: 'S256',
        }),
      });
      const payload = await readCommunityAuthPayload(response);
      const loginUrl = typeof payload?.login_url === 'string' ? payload.login_url : null;
      if (!response.ok || !loginUrl || !loginUrl.startsWith(`${COMMUNITY_AUTH_ORIGIN}/`)) {
        console.warn(
          `[CommunityAuth] login initialization returned an invalid response with status ${response.status}`,
        );
        return { success: false, error: t('communityAuthServiceUnavailable') };
      }
      pendingCommunityLogin = { state, verifier, expiresAt: Date.now() + 10 * 60 * 1000 };
      await shell.openExternal(loginUrl);
      return { success: true };
    } catch (error) {
      console.error('[Auth] login failed:', error);
      return {
        success: false,
        error: t('communityAuthServiceUnavailable'),
      };
    }
  });

  ipcMain.handle(WorkspaceIpc.List, async () => {
    try {
      const store = getCoworkStore();
      let workspaces = store.listWorkspaces();
      for (const workspace of workspaces) {
        if (isDefaultConversationWorkspacePath(workspace.path)) {
          if (workspace.isHidden) store.setWorkspaceHidden(workspace.id, false);
          continue;
        }
        if (!workspace.isHidden && isInternalWorkspacePath(workspace.path)) {
          store.setWorkspaceHidden(workspace.id, true);
        }
      }
      workspaces = store.listWorkspaces();
      if (getStore().get<boolean>(WorkspaceStoreKey.DefaultConversationInitialized) !== true) {
        const defaultWorkspacePath = getDefaultConversationWorkspacePath();
        await fs.promises.mkdir(defaultWorkspacePath, { recursive: true });
        const defaultWorkspace = store.ensureWorkspace(defaultWorkspacePath);
        store.setWorkspaceHidden(defaultWorkspace.id, false);
        getStore().set(WorkspaceStoreKey.DefaultConversationInitialized, true);
        workspaces = store.listWorkspaces();
      }
      return { success: true, workspaces };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list workspaces',
      };
    }
  });

  ipcMain.handle(
    WorkspaceIpc.Create,
    async (_event, rawOptions: { path?: string; name?: string }) => {
      try {
        const workspacePath = rawOptions?.path?.trim();
        const workspaceName = rawOptions?.name?.trim();
        if (!workspacePath) return { success: false, error: 'Workspace path is required' };
        if (!workspaceName) return { success: false, error: 'Workspace name is required' };

        const defaultWorkspacePath = getDefaultProjectBaseDir();
        const resolvedWorkspacePath = path.resolve(workspacePath);
        const resolvedDefaultPath = path.resolve(defaultWorkspacePath);
        const isDefaultWorkspacePath =
          process.platform === 'win32'
            ? resolvedWorkspacePath.toLowerCase() === resolvedDefaultPath.toLowerCase()
            : resolvedWorkspacePath === resolvedDefaultPath;
        if (isDefaultWorkspacePath) {
          await fs.promises.mkdir(resolvedWorkspacePath, { recursive: true });
        }
        const stat = await fs.promises.stat(resolvedWorkspacePath);
        if (!stat.isDirectory())
          return { success: false, error: 'Workspace path is not a directory' };

        const workspace = getCoworkStore().createWorkspace(resolvedWorkspacePath, workspaceName);
        return { success: true, workspace };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to create workspace',
        };
      }
    },
  );

  ipcMain.handle(
    WorkspaceIpc.Ensure,
    async (_event, rawOptions: { path?: string; name?: string; isHidden?: boolean }) => {
      try {
        const workspacePath = rawOptions?.path?.trim();
        if (!workspacePath) return { success: false, error: 'Workspace path is required' };
        const workspace = getCoworkStore().ensureWorkspace(
          workspacePath,
          rawOptions.name,
          rawOptions.isHidden === true,
        );
        return { success: true, workspace };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to ensure workspace',
        };
      }
    },
  );

  ipcMain.handle(WorkspaceIpc.Rename, async (_event, id: string, name: string) => {
    try {
      const normalizedName = name.trim();
      if (!normalizedName) return { success: false, error: 'Workspace name is required' };

      const coworkStore = getCoworkStore();
      const workspace = coworkStore.getWorkspace(id);
      if (!workspace) return { success: false, error: 'Workspace not found' };
      if (isDefaultConversationWorkspacePath(workspace.path)) {
        return { success: false, error: 'The default conversation workspace cannot be renamed' };
      }
      const renamedWorkspace = coworkStore.renameWorkspace(id, normalizedName);
      if (!renamedWorkspace) return { success: false, error: 'Workspace not found' };
      return { success: true, workspace: renamedWorkspace };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to rename workspace',
      };
    }
  });

  ipcMain.handle(
    WorkspaceIpc.Update,
    async (
      _event,
      rawOptions: { id?: string; name?: string; primaryPath?: string; folders?: string[] },
    ) => {
      try {
        const id = rawOptions?.id?.trim();
        if (!id) return { success: false, error: 'Workspace id is required' };
        const coworkStore = getCoworkStore();
        const workspace = coworkStore.getWorkspace(id);
        if (!workspace) return { success: false, error: 'Workspace not found' };

        const requestedName = rawOptions.name?.trim();
        const requestedPath = rawOptions.primaryPath?.trim();
        const pathsEqual = (a: string, b: string): boolean =>
          process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
        // Resolve both sides so trailing separators or relative segments cannot
        // smuggle a duplicate of the primary path into the attached folders.
        const resolvedFolders = rawOptions.folders
          ?.map(folder => folder.trim())
          .filter(Boolean)
          .map(folder => path.resolve(folder));
        const pathChanged =
          !!requestedPath && !pathsEqual(path.resolve(requestedPath), path.resolve(workspace.path));

        if (pathChanged) {
          if (isDefaultConversationWorkspacePath(workspace.path)) {
            return {
              success: false,
              error: 'The default conversation workspace path cannot be changed',
            };
          }
          const resolvedPath = path.resolve(requestedPath!);
          const stat = await fs.promises.stat(resolvedPath).catch((): null => null);
          if (!stat?.isDirectory()) {
            return { success: false, error: 'Workspace path is not a directory' };
          }
          const relocated = coworkStore.relocateWorkspace(
            id,
            resolvedPath,
            requestedName || workspace.name,
          );
          if (!relocated) return { success: false, error: 'Workspace not found' };
          if (rawOptions.folders) {
            coworkStore.setWorkspaceFolders(
              relocated.id,
              (resolvedFolders ?? []).filter(folder => !pathsEqual(folder, resolvedPath)),
            );
            coworkStore.touchWorkspace(relocated.id);
          }
          return { success: true, workspace: coworkStore.getWorkspace(relocated.id) };
        }

        if (requestedName && requestedName !== workspace.name) {
          if (isDefaultConversationWorkspacePath(workspace.path)) {
            return {
              success: false,
              error: 'The default conversation workspace cannot be renamed',
            };
          }
          const renamed = coworkStore.renameWorkspace(id, requestedName);
          if (!renamed) return { success: false, error: 'Workspace not found' };
        }
        if (rawOptions.folders) {
          coworkStore.setWorkspaceFolders(
            id,
            (resolvedFolders ?? []).filter(
              folder => !pathsEqual(folder, path.resolve(workspace.path)),
            ),
          );
          coworkStore.touchWorkspace(id);
        }
        return { success: true, workspace: coworkStore.getWorkspace(id) };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to update workspace',
        };
      }
    },
  );

  ipcMain.handle(WorkspaceIpc.Delete, async (_event, id: string) => {
    try {
      if (typeof id !== 'string' || !id.trim()) {
        return { success: false, error: 'Workspace id is required' };
      }
      const coworkStore = getCoworkStore();
      const workspace = coworkStore.getWorkspace(id);
      if (!workspace) return { success: false, error: 'Workspace not found' };
      if (isDefaultConversationWorkspacePath(workspace.path)) {
        return { success: false, error: 'The default conversation workspace cannot be removed' };
      }
      for (const sessionId of listAllMatchingSessionIds({ workspaceId: id })) {
        forgetCoworkSession(sessionId);
      }
      const deletedSessionIds = coworkStore.deleteWorkspace(id);
      console.log(
        `[CoworkStore] removed a workspace along with ${deletedSessionIds.length} session(s)`,
      );
      return { success: true, deletedSessionIds };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to remove workspace',
      };
    }
  });

  // Project working-directory helpers
  const getDefaultProjectBaseDir = () =>
    path.join(app.getPath('documents'), 'ZhiYuanAgent', 'Workspaces');
  const getUnmanagedWorkspaceBaseDir = () =>
    path.join(app.getPath('userData'), 'unmanaged-workspaces');
  const isUuidDirectoryName = (directoryName: string): boolean =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(directoryName);
  const isLegacyUnmanagedWorkspacePath = (candidatePath: string): boolean => {
    const relativePath = path.relative(getDefaultProjectBaseDir(), candidatePath);
    return !relativePath.includes(path.sep) && isUuidDirectoryName(relativePath);
  };
  const isUnmanagedWorkspacePath = (candidatePath: string): boolean => {
    const relativePath = path.relative(getUnmanagedWorkspaceBaseDir(), candidatePath);
    return (
      Boolean(relativePath) && !relativePath.startsWith('..') && !path.isAbsolute(relativePath)
    );
  };
  const isInternalWorkspacePath = (candidatePath: string): boolean =>
    isLegacyUnmanagedWorkspacePath(candidatePath) || isUnmanagedWorkspacePath(candidatePath);

  ipcMain.handle(ProjectIpc.GetDefaultBaseDir, async () => {
    try {
      return { success: true, path: getDefaultProjectBaseDir() };
    } catch (error) {
      return {
        success: false,
        path: null,
        error: error instanceof Error ? error.message : 'Failed to resolve default project path',
      };
    }
  });

  ipcMain.handle(ProjectIpc.CreateDirectory, async (_event, rawOptions: unknown) => {
    try {
      const options = ProjectCreateDirectorySchema.input.parse(rawOptions);
      const name = options.name.trim();
      if (!name || /[\\/:*?"<>|]/.test(name) || name === '.' || name === '..') {
        return { success: false, path: null, code: 'invalid-name', error: 'Invalid project name' };
      }
      const baseDir = options.baseDir?.trim() || getDefaultProjectBaseDir();
      const targetPath = path.join(baseDir, name);
      if (fs.existsSync(targetPath)) {
        return {
          success: false,
          path: null,
          code: 'already-exists',
          error: 'A directory with this name already exists',
        };
      }
      await fs.promises.mkdir(targetPath, { recursive: true });
      console.log('[Project] created project directory:', targetPath);
      return { success: true, path: targetPath };
    } catch (error) {
      return {
        success: false,
        path: null,
        error: error instanceof Error ? error.message : 'Failed to create project directory',
      };
    }
  });

  ipcMain.handle(ProjectIpc.EnsureScratchDir, async () => {
    try {
      const scratchDir = getDefaultConversationWorkspacePath();
      await fs.promises.mkdir(scratchDir, { recursive: true });
      return { success: true, path: scratchDir };
    } catch (error) {
      return {
        success: false,
        path: null,
        error: error instanceof Error ? error.message : 'Failed to ensure scratch directory',
      };
    }
  });

  ipcMain.handle(ProjectIpc.CreateRandomWorkspace, async () => {
    try {
      const randomWorkspacePath = path.join(getUnmanagedWorkspaceBaseDir(), crypto.randomUUID());
      await fs.promises.mkdir(randomWorkspacePath, { recursive: true });
      return { success: true, path: randomWorkspacePath };
    } catch (error) {
      return {
        success: false,
        path: null,
        error: error instanceof Error ? error.message : 'Failed to create random workspace',
      };
    }
  });

  registerDurableIpc(ipcMain, getPiRuntimeAdapter, sessionId =>
    Boolean(getCoworkStore().getSession(sessionId, 0)),
  );
  const initializeHistoryService = () => {
    historyIndexDb = new Database(path.join(app.getPath('userData'), 'history-index.sqlite'));
    historyIndexDb.pragma('journal_mode = WAL');
    historyService = registerHistoryIpc({
      ipcMain,
      db: getStore().getDatabase(),
      indexDb: historyIndexDb,
      native: getPiRuntimeAdapter(),
      maintenance: {
        dataRoot: app.getPath('userData'),
        async chooseDirectory(kind) {
          const options: Electron.OpenDialogOptions = {
            properties:
              kind === 'backup' ? ['openDirectory', 'createDirectory'] : ['openDirectory'],
          };
          const result = mainWindow
            ? await dialog.showOpenDialog(mainWindow, options)
            : await dialog.showOpenDialog(options);
          return result.canceled ? null : (result.filePaths[0] ?? null);
        },
        restart() {
          recordAppQuitOrigin(AppQuitOrigin.RendererRelaunch);
          app.relaunch();
          app.quit();
        },
      },
      assertTrustedSender(event) {
        if (
          !mainWindow ||
          mainWindow.isDestroyed() ||
          event.sender !== mainWindow.webContents ||
          event.senderFrame !== mainWindow.webContents.mainFrame
        )
          throw new Error('Untrusted history request');
      },
    });
  };
  registerWorkDocumentIpc(ipcMain, getPiRuntimeAdapter, sessionId =>
    Boolean(getCoworkStore().getSession(sessionId, 0)),
  );
  magpieManager = new MagpieManager({
    resourcesRoot: app.isPackaged
      ? path.join(process.resourcesPath, 'magpie')
      : path.join(app.getAppPath(), 'resources/magpie'),
    privateHome: path.join(app.getPath('userData'), 'magpie'),
    serviceEnabled: {
      read: () => getStore().get<boolean>('magpie_service_enabled') === true,
      write: enabled => getStore().set('magpie_service_enabled', enabled),
    },
    subscriptionAccounts: {
      read: () => getStore().get<boolean>('magpie_subscription_accounts_enabled') === true,
      write: enabled => getStore().set('magpie_subscription_accounts_enabled', enabled),
    },
  });
  managedMagpieBindings = new ManagedMagpieProviderBindings(
    zhiyuanManagedProviderBridge,
    magpieManager,
  );
  managedMagpieBindings.setOllamaReader(() => readOllamaProviderSnapshot(getOllamaManager()));
  managedMagpieBindings.setGpuReader(async () => {
    const daemon = llamaCppModelDaemonController;
    if (!daemon) return { baseUrl: null, models: [] };
    const models = await daemon.listRunningModels();
    return {
      baseUrl: daemon.gatewayBaseUrl(),
      models: models
        .map(buildLlamaCppRunningModelBinding)
        .filter((model): model is NonNullable<typeof model> => Boolean(model)),
    };
  });
  const modelService = new MagpieModelService(magpieManager, {
    readDefaultModelId: () => getStore().get<string>('magpie_default_model_id'),
    writeDefaultModelId: id => getStore().set('magpie_default_model_id', id),
    beforeCatalog: () => managedMagpieBindings!.beforeCatalog(),
    allowedModel: model => managedMagpieBindings!.allowedModel(model.id),
  });
  disposeMagpieModels = installMagpieModelService(modelService);
  disposeMagpie = registerMagpieIpc(
    magpieManager,
    event =>
      Boolean(
        mainWindow &&
        !mainWindow.isDestroyed() &&
        event.sender === mainWindow.webContents &&
        event.senderFrame === mainWindow.webContents.mainFrame,
      ),
    modelService,
  );
  // Cowork IPC handlers
  ipcMain.handle(CoworkSessionIpc.Start, async (_event, rawOptions: unknown) => {
    const cid = generateCorrelationId();
    const log = createLogger('CoworkSession').withContext({ cid });
    const options = CoworkSessionStartSchema.input.parse(rawOptions);
    log.info('session start requested', {
      prompt: options.prompt.slice(0, 80),
      agentId: options.agentId,
      systemPromptLen: options.systemPrompt?.length ?? 0,
    });
    return runWithCorrelationId(cid, async () => {
      try {
        // Work sessions use Pi (SDK mode, instant availability). No need to wait
        // for channel delivery; that gate applies only to IM/Cron paths.
        const coworkStoreInstance = getCoworkStore();
        const config = coworkStoreInstance.getConfig();
        const selectedAgent = getAgentManager().getAgent(options.agentId || 'main');
        const fallbackExpertIds =
          selectedAgent &&
          (selectedAgent.source === CoworkSessionExpertSource.Package ||
            selectedAgent.source === CoworkSessionExpertSource.Member)
            ? [selectedAgent.id]
            : [];
        const expertSnapshots = resolveSessionExpertSnapshots(
          options.expertIds ?? fallbackExpertIds,
        );
        // The renderer already includes the selected non-expert agent prompt when
        // present. Treat that request value as the source prompt instead of
        // appending the same agent prompt again in the main process.
        const isChatSession = options.mode === CoworkSessionMode.Chat;
        const basePrompt = isChatSession
          ? (options.systemPrompt ?? '')
          : (options.systemPrompt ?? selectedAgent?.systemPrompt ?? config.systemPrompt);
        const systemPrompt = isChatSession
          ? basePrompt.trim()
          : composeCoworkSystemPrompt({
              basePrompt,
              expertSnapshots,
              language: resolveCoworkPromptLanguage(),
            });
        const workspace = options.workspaceId
          ? coworkStoreInstance.getWorkspace(options.workspaceId)
          : null;
        const selectedTaskDirectory = resolveSessionWorkingDirectory({
          cwd: options.cwd || workspace?.path,
        });

        if (!selectedTaskDirectory) {
          return {
            success: false,
            error: 'Please select a task folder before submitting.',
          };
        }
        const selectedWorkspace =
          workspace || coworkStoreInstance.ensureWorkspace(selectedTaskDirectory);

        const fallbackTitle = buildSessionTitleFromInput(
          options.prompt,
          t('coworkDefaultSessionTitle'),
        );
        const title = options.title?.trim() || fallbackTitle;
        const taskWorkingDirectory = resolveTaskWorkingDirectory(selectedTaskDirectory);

        const priorSessionId = options.requestId
          ? getStore().get<string>(`cowork-start:${options.requestId}`)
          : undefined;
        const priorSession = priorSessionId
          ? coworkStoreInstance.getSession(priorSessionId)
          : undefined;
        const session =
          priorSession ??
          coworkStoreInstance.createSession(
            title,
            taskWorkingDirectory,
            systemPrompt,
            config.executionMode || CoworkExecutionMode.Local,
            options.activeSkillIds || [],
            options.agentId || 'main',
            options.modelOverride || '',
            options.mode ?? CoworkSessionMode.Work,
            undefined,
            selectedWorkspace.id,
            expertSnapshots,
          );

        if (options.requestId) getStore().set(`cowork-start:${options.requestId}`, session.id);

        if (options.modelOverride) {
          console.log(
            '[Cowork:StartSession] session created with modelOverride:',
            session.id,
            options.modelOverride,
          );
        }

        // Build metadata, include imageAttachments if present
        const messageMetadata: Record<string, unknown> = {};
        if (expertSnapshots.length > 0) {
          messageMetadata.experts = expertSnapshots.map(expert => ({
            expertId: expert.expertId,
            expertName: expert.expertName,
            presetId: expert.packageId,
          }));
        }
        if (options.activeSkillIds?.length) {
          messageMetadata.skillIds = options.activeSkillIds;
        }
        let storedImages: ReturnType<typeof persistCoworkImageAttachments> | undefined;
        if (options.imageAttachments?.length) {
          console.log('[Cowork:StartSession] imageAttachments received via IPC:', {
            count: options.imageAttachments.length,
            details: options.imageAttachments.map(img => ({
              name: img.name,
              mimeType: img.mimeType,
              base64Length: img.base64Data?.length ?? 0,
            })),
          });
          // Persist once at the IPC boundary; runtime receives paths only.
          storedImages = persistCoworkImageAttachments(
            getCoworkImageRoot(),
            session.id,
            options.imageAttachments,
          );
          messageMetadata.imageAttachments = storedImages;
        }
        if (options.fileAttachments?.length) {
          messageMetadata.fileAttachments = options.fileAttachments;
        }
        const initialMessage =
          priorSession?.messages.find(message => message.type === 'user') ??
          coworkStoreInstance.addMessage(session.id, {
            type: 'user',
            content: options.prompt,
            metadata: Object.keys(messageMetadata).length > 0 ? messageMetadata : undefined,
          });
        coworkStoreInstance.touchWorkspace(session.workspaceId);

        // Start the session asynchronously (skip initial user message since we already added it)
        const runtime = getPiRuntimeAdapter();
        await runtime.startSession(session.id, options.prompt, {
          skipInitialUserMessage: true,
          _userMessageId: initialMessage.id,
          requestId: options.requestId,
          systemPrompt,
          workspaceRoot: taskWorkingDirectory,
          confirmationMode: 'modal',
          sessionMode: options.mode ?? CoworkSessionMode.Work,
          goalMode: options.goalMode,
          approvalMode:
            (options.permissionMode ?? config.permissionMode) === CoworkPermissionMode.AllowAll
              ? ToolApprovalMode.AllowAll
              : ToolApprovalMode.Ask,
          imageAttachments: storedImages,
          fileAttachments: options.fileAttachments,
          agentId: options.agentId,
          expertIds: expertSnapshots.map(expert => expert.expertId),
          modelOverride: options.modelOverride,
        });

        const sessionWithMessages = coworkStoreInstance.getSession(session.id) || {
          ...session,
          status: 'idle' as const,
        };
        return { success: true, session: sanitizeCoworkSessionForIpc(sessionWithMessages) };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to start session',
        };
      }
    });
  });

  ipcMain.handle(CoworkSessionIpc.Continue, async (_event, rawOptions: unknown) => {
    try {
      const options = CoworkSessionContinueSchema.input.parse(rawOptions);
      // Work sessions use Pi (SDK mode, instant availability).
      const runtime = getPiRuntimeAdapter();
      const store = getCoworkStore();
      const priorContinuation = options.requestId
        ? getStore().get<string>(`cowork-continue:${options.requestId}`)
        : undefined;
      if (priorContinuation && store.getSession(priorContinuation))
        options.sessionId = priorContinuation;
      let existingSession = store.getSession(options.sessionId);
      if (existingSession && !(await runtime.hasDurableWork(existingSession.id))) {
        const previous = existingSession;
        const replacement = store.createSession(
          previous.title,
          previous.cwd,
          previous.systemPrompt,
          previous.executionMode,
          [],
          previous.agentId,
          previous.modelOverride,
          previous.mode,
          undefined,
          previous.workspaceId,
          previous.experts,
        );
        store.addMessage(replacement.id, {
          type: 'system',
          content: t('durableNewWorkFromHistory', { title: previous.title }),
          metadata: { sourceSessionId: previous.id },
        });
        if (options.requestId)
          getStore().set(`cowork-continue:${options.requestId}`, replacement.id);
        options.sessionId = replacement.id;
        existingSession = replacement;
      }

      if (existingSession) {
        const previousExpertSnapshots = existingSession.experts;
        const expertSnapshots =
          options.expertIds === undefined ||
          haveSameExpertIds(previousExpertSnapshots, options.expertIds)
            ? previousExpertSnapshots.slice(0, 1)
            : resolveSessionExpertSnapshots(options.expertIds);
        const isChatSession = existingSession?.mode === CoworkSessionMode.Chat;
        const nextSystemPrompt = isChatSession
          ? (options.systemPrompt ?? '').trim()
          : composeCoworkSystemPrompt({
              basePrompt: existingSession.systemPrompt || options.systemPrompt,
              expertSnapshots,
              previousExpertSnapshots,
              language: resolveCoworkPromptLanguage(),
            });
        const expertsChanged = !haveSameExpertSnapshots(previousExpertSnapshots, expertSnapshots);
        if (expertsChanged) {
          store.replaceSessionExperts(options.sessionId, expertSnapshots);
        }
        if (nextSystemPrompt !== existingSession.systemPrompt) {
          store.updateSession(options.sessionId, { systemPrompt: nextSystemPrompt });
        }
        if (expertsChanged || nextSystemPrompt !== existingSession.systemPrompt) {
          existingSession = store.getSession(options.sessionId);
        }
      }
      let storedImages: ReturnType<typeof persistCoworkImageAttachments> | undefined;
      if (options.imageAttachments?.length) {
        console.log('[Cowork:ContinueSession] imageAttachments received via IPC:', {
          sessionId: options.sessionId,
          count: options.imageAttachments.length,
          details: options.imageAttachments.map(img => ({
            name: img.name,
            mimeType: img.mimeType,
            base64Length: img.base64Data?.length ?? 0,
          })),
        });
        // Persist once at the IPC boundary; runtime receives paths only.
        storedImages = persistCoworkImageAttachments(
          getCoworkImageRoot(),
          options.sessionId,
          options.imageAttachments,
        );
      }

      const sessionMode = existingSession?.mode ?? CoworkSessionMode.Work;

      const runtimeSystemPrompt = existingSession
        ? existingSession.systemPrompt
        : sessionMode === CoworkSessionMode.Chat
          ? (options.systemPrompt ?? '').trim()
          : composeCoworkSystemPrompt({
              basePrompt: options.systemPrompt,
              language: resolveCoworkPromptLanguage(),
            });

      if (existingSession && options.prompt.trim()) {
        store.touchWorkspace(existingSession.workspaceId);
      }

      try {
        await applyMessageTriageRouting(options.sessionId, options.prompt);
      } catch (triageError) {
        console.warn('[Triage] routing failed; continuing with the current model:', triageError);
      }

      await runtime.continueSession(options.sessionId, options.prompt, {
        requestId: options.requestId,
        systemPrompt: runtimeSystemPrompt,
        sessionMode,
        goalMode: options.goalMode,
        imageAttachments: storedImages,
        fileAttachments: options.fileAttachments,
        workspaceRoot: existingSession?.cwd,
        agentId: existingSession?.agentId,
        expertIds: existingSession?.experts.map(expert => expert.expertId),
        modelOverride: existingSession?.modelOverride,
        approvalMode:
          (options.permissionMode ??
            store.getConfig().permissionModeBySession[options.sessionId] ??
            store.getConfig().permissionMode) === CoworkPermissionMode.AllowAll
            ? ToolApprovalMode.AllowAll
            : ToolApprovalMode.Ask,
      });

      const session = getCoworkStore().getSession(options.sessionId);
      if (session) materializeSessionImages(options.sessionId, session.messages);
      return { success: true, session: session ? sanitizeCoworkSessionForIpc(session) : session };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to continue session',
      };
    }
  });

  ipcMain.handle(CoworkQueueIpc.List, async (_event, rawInput: unknown) => {
    try {
      const sessionId = CoworkQueueSessionSchema.parse(rawInput);
      return {
        success: true,
        items: slimQueuedMessagesForIpc(getPiRuntimeAdapter().listPendingMessages(sessionId)),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list pending messages',
      };
    }
  });

  ipcMain.handle(CoworkQueueIpc.Enqueue, async (_event, rawInput: unknown) => {
    try {
      const input = CoworkQueueEnqueueSchema.parse(rawInput);
      const storedImages = input.imageAttachments?.length
        ? persistCoworkImageAttachments(
            getCoworkImageRoot(),
            input.sessionId,
            input.imageAttachments,
          )
        : undefined;
      const enqueueResult = await getPiRuntimeAdapter().enqueuePendingMessage(
        input.sessionId,
        input.text,
        storedImages,
        input.fileAttachments,
        input.requestId,
      );
      return enqueueResult;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to enqueue pending message',
      };
    }
  });

  ipcMain.handle(CoworkQueueIpc.Update, async (_event, rawInput: unknown) => {
    try {
      const input = CoworkQueueUpdateSchema.parse(rawInput);
      return getPiRuntimeAdapter().updatePendingMessage(input.sessionId, input.itemId, input.text);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update pending message',
      };
    }
  });

  ipcMain.handle(CoworkQueueIpc.Delete, async (_event, rawInput: unknown) => {
    try {
      const input = CoworkQueueItemSchema.parse(rawInput);
      return getPiRuntimeAdapter().deletePendingMessage(input.sessionId, input.itemId);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete pending message',
      };
    }
  });

  ipcMain.handle(CoworkQueueIpc.Steer, async (_event, rawInput: unknown) => {
    try {
      const input = CoworkQueueItemSchema.parse(rawInput);
      return await getPiRuntimeAdapter().steerPendingMessage(input.sessionId, input.itemId);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to steer pending message',
      };
    }
  });

  ipcMain.handle(CoworkQueueIpc.FollowUp, async (_event, rawInput: unknown) => {
    try {
      const input = CoworkQueueItemSchema.parse(rawInput);
      return await getPiRuntimeAdapter().followUpPendingMessage(input.sessionId, input.itemId);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to send follow-up message',
      };
    }
  });

  ipcMain.handle('cowork:session:stop', async (_event, sessionId: string) => {
    try {
      const runtime = getPiRuntimeAdapter();
      await runtime.stopSession(sessionId);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to stop session',
      };
    }
  });

  // `/compact` from the composer: never becomes model input. While a turn is
  // in flight the compaction waits behind the queued prompts, otherwise it
  // runs now; failures are classified so the renderer can localize them.
  ipcMain.handle(
    CoworkSessionIpc.Compact,
    async (_event, rawSessionId: unknown): Promise<CoworkCompactResult> => {
      try {
        const sessionId = typeof rawSessionId === 'string' ? rawSessionId.trim() : '';
        const runtime = getPiRuntimeAdapter();
        if (!sessionId || runtime.isSessionActive(sessionId) === false) {
          return { success: false, reason: CoworkCompactFailure.NoSession };
        }
        if (runtime.isSessionRunning(sessionId)) {
          const queued = runtime.enqueueControlAction(sessionId, async () => {
            try {
              await runtime.compactSession(sessionId);
            } catch (error) {
              console.error('[Cowork] queued session compaction failed:', error);
            }
          });
          return queued.success
            ? { success: true, queued: true }
            : { success: false, reason: CoworkCompactFailure.Busy };
        }
        try {
          const result = await runtime.compactSession(sessionId);
          return { success: true, queued: false, cancelled: result.cancelled };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (/nothing to compact|session too small/i.test(message)) {
            return { success: false, reason: CoworkCompactFailure.NotNeeded };
          }
          // A retained-but-not-live session, or a turn that started between
          // the liveness check and the compact call.
          if (/not active/i.test(message)) {
            return { success: false, reason: CoworkCompactFailure.NoSession };
          }
          if (/still running/i.test(message)) {
            return { success: false, reason: CoworkCompactFailure.Busy };
          }
          throw error;
        }
      } catch (error) {
        console.error('[Cowork] session compaction failed:', error);
        return { success: false, reason: CoworkCompactFailure.Failed };
      }
    },
  );

  ipcMain.handle(
    'cowork:session:save',
    async (
      _event,
      session: {
        id: string;
        title: string;
        status: string;
        mode: 'work' | 'chat';
        cwd: string;
        systemPrompt: string;
        modelOverride: string;
        executionMode: string;
        activeSkillIds: string[];
        agentId: string;
        messages: Array<{
          id: string;
          type: string;
          content: string;
          timestamp: number;
          metadata?: Record<string, unknown>;
        }>;
      },
    ) => {
      try {
        const existing = coworkStore.getSession(session.id);
        if (existing) {
          // Session already exists — update status and sync new messages
          coworkStore.updateSession(session.id, { status: session.status as CoworkSessionStatus });
          for (const msg of session.messages || []) {
            coworkStore.upsertMessage(session.id, {
              id: msg.id,
              type: msg.type as CoworkMessageType,
              content: msg.content,
              timestamp: msg.timestamp,
              metadata: persistMessageImageMetadata(getCoworkImageRoot(), session.id, msg.metadata)
                .metadata as CoworkMessageMetadata | undefined,
            });
          }
          const updated = coworkStore.getSession(session.id);
          return {
            success: true,
            session: updated ? sanitizeCoworkSessionForIpc(updated) : updated,
          };
        }
        // Create new session in SQLite
        const newSession = coworkStore.createSession(
          session.title,
          session.cwd,
          session.systemPrompt || '',
          parseCoworkExecutionMode(session.executionMode) ?? CoworkExecutionMode.Local,
          session.activeSkillIds || [],
          session.agentId || 'main',
          session.modelOverride || '',
          session.mode || 'work',
          session.id,
        );
        // Save messages
        for (const msg of session.messages || []) {
          coworkStore.upsertMessage(newSession.id, {
            id: msg.id,
            type: msg.type as CoworkMessageType,
            content: msg.content,
            timestamp: msg.timestamp,
            metadata: persistMessageImageMetadata(getCoworkImageRoot(), newSession.id, msg.metadata)
              .metadata as CoworkMessageMetadata | undefined,
          });
        }
        // Update status
        coworkStore.updateSession(newSession.id, { status: session.status as CoworkSessionStatus });
        const saved = coworkStore.getSession(newSession.id);
        return { success: true, session: saved ? sanitizeCoworkSessionForIpc(saved) : saved };
      } catch (error) {
        console.error('[Cowork] Failed to save session:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    },
  );

  ipcMain.handle('cowork:session:delete', async (_event, sessionId: string) => {
    try {
      // Purge runtime state first so late events cannot write to the session
      // after the DB row is removed.
      forgetCoworkSession(sessionId);
      const coworkStoreInstance = getCoworkStore();
      coworkStoreInstance.deleteSession(sessionId);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete session',
      };
    }
  });

  ipcMain.handle('cowork:session:deleteBatch', async (_event, sessionIds: string[]) => {
    try {
      // Purge runtime state before deleting DB rows so late events cannot
      // recreate or write to sessions that are being removed.
      for (const sessionId of sessionIds) {
        forgetCoworkSession(sessionId);
      }
      const coworkStoreInstance = getCoworkStore();
      coworkStoreInstance.deleteSessions(sessionIds);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to batch delete sessions',
      };
    }
  });

  ipcMain.handle(
    'cowork:session:pin',
    async (_event, options: { sessionId: string; pinned: boolean }) => {
      try {
        const coworkStoreInstance = getCoworkStore();
        const pinOrder = coworkStoreInstance.setSessionPinned(options.sessionId, options.pinned);
        return { success: true, pinOrder };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to update session pin',
        };
      }
    },
  );

  ipcMain.handle(
    'cowork:session:rename',
    async (_event, options: { sessionId: string; title: string }) => {
      try {
        const coworkStoreInstance = getCoworkStore();
        // Scheduled rows are identified by their `source`; the stored title keeps
        // the canonical prefix so it cannot drift from migrated/renamed rows.
        const existing = coworkStoreInstance.getSession(options.sessionId, 0);
        const title = normalizeRenamedSessionTitle(
          options.title,
          existing?.source === CoworkSessionSource.Scheduled,
        ).trim();
        if (!title) {
          return { success: false, error: 'Title is required' };
        }
        coworkStoreInstance.updateSession(
          options.sessionId,
          { title },
          { userInitiatedTitleChange: true },
        );
        // Report the stored (normalized) title: the renderer echoes this value
        // into redux, and a scheduled rename adds the canonical prefix.
        return { success: true, title };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to rename session',
        };
      }
    },
  );

  ipcMain.handle(CoworkSessionIpc.UpdateModel, async (_event, rawInput: unknown) => {
    try {
      const input = CoworkSessionUpdateModelSchema.input.parse(rawInput);
      const store = getCoworkStore();
      const existing = store.getSession(input.sessionId, 0);
      if (!existing) {
        return { success: false, error: 'Session not found' };
      }
      store.updateSession(
        input.sessionId,
        { modelOverride: input.modelOverride },
        { touchUpdatedAt: false },
      );
      return { success: true, session: store.getSession(input.sessionId, 0) };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update session model',
      };
    }
  });

  ipcMain.handle(
    CoworkSessionIpc.Get,
    async (_event, sessionId: string, options?: { messageLimit?: number | null }) => {
      try {
        const store = getCoworkStore();
        // Default: latest page only for the main transcript UI. Callers that need
        // the full history (e.g. scheduled-task run viewer) pass messageLimit: null.
        const session =
          options && 'messageLimit' in options
            ? store.getSession(sessionId, options.messageLimit)
            : store.getSession(sessionId);
        if (!session) return { success: true, session: null };
        materializeSessionImages(sessionId, session.messages);

        const reconciledSession = reconcileWorkSessionRuntimeState(
          session,
          getPiRuntimeAdapter().isSessionRunning(sessionId),
        );
        if (reconciledSession.status !== session.status) {
          store.updateSession(sessionId, { status: reconciledSession.status });
        }
        return { success: true, session: sanitizeCoworkSessionForIpc(reconciledSession) };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get session',
        };
      }
    },
  );

  ipcMain.handle(
    CoworkSessionIpc.List,
    async (
      _event,
      options?: {
        limit?: number;
        offset?: number;
        agentId?: string;
        workspaceId?: string;
        mode?: CoworkSessionMode;
        sources?: CoworkSessionSource[];
      },
    ) => {
      try {
        const limit = options?.limit ?? COWORK_SESSION_PAGE_SIZE;
        const offset = options?.offset ?? 0;
        const agentId = options?.agentId;
        const workspaceId = options?.workspaceId;
        const mode = options?.mode;
        const sources = options?.sources;
        const store = getCoworkStore();
        const sessions = store
          .listSessions(limit, offset, agentId, workspaceId, mode, sources)
          .map(session => {
            const reconciledSession = reconcileWorkSessionRuntimeState(
              session,
              getPiRuntimeAdapter().isSessionRunning(session.id),
            );
            if (reconciledSession.status !== session.status) {
              store.updateSession(session.id, { status: reconciledSession.status });
            }
            return reconciledSession;
          });
        const total = store.countSessions(agentId, workspaceId, mode, sources);
        return { success: true, sessions, hasMore: offset + sessions.length < total };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to list sessions',
        };
      }
    },
  );

  ipcMain.handle(
    CoworkSessionIpc.GetMessages,
    async (_event, options: { sessionId: string; limit?: number; offset?: number }) => {
      try {
        const { sessionId, limit = COWORK_MESSAGE_PAGE_SIZE, offset = 0 } = options;
        const store = getCoworkStore();
        const total = store.countSessionMessages(sessionId);
        const messages = store.getPagedSessionMessages(sessionId, limit, offset);
        materializeSessionImages(sessionId, messages);
        return {
          success: true,
          messages: messages.map(message => slimCoworkMessageForIpc(message)),
          offset,
          total,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get session messages',
        };
      }
    },
  );

  // ========== Agent IPC Handlers ==========

  ipcMain.handle(AgentIpcChannel.List, async () => {
    try {
      const agents = getAgentManager().listAgents();
      return { success: true, agents };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list agents',
      };
    }
  });

  ipcMain.handle(AgentIpcChannel.Get, async (_event, id: string) => {
    try {
      const agent = getAgentManager().getAgent(id);
      return { success: true, agent };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get agent',
      };
    }
  });

  ipcMain.handle(
    AgentIpcChannel.Create,
    async (_event, request: import('./coworkStore').CreateAgentRequest) => {
      try {
        const agent = getAgentManager().createAgent(request, resolveDefaultAgentModelRef());
        bumpCodingCommandCatalog();
        return { success: true, agent };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to create agent',
        };
      }
    },
  );

  ipcMain.handle(
    AgentIpcChannel.Update,
    async (_event, id: string, updates: import('./coworkStore').UpdateAgentRequest) => {
      try {
        const agent = getAgentManager().updateAgent(id, updates);
        bumpCodingCommandCatalog();
        return { success: true, agent };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to update agent',
        };
      }
    },
  );

  ipcMain.handle(AgentIpcChannel.Delete, async (_event, id: string) => {
    try {
      const result = getAgentManager().deleteAgent(id);
      if (result) bumpCodingCommandCatalog();

      // Cascade delete all Cowork sessions belonging to the deleted agent
      const coworkStore = getCoworkStore();
      for (const sessionId of listAllMatchingSessionIds({ agentId: id })) {
        forgetCoworkSession(sessionId);
      }
      const deletedSessionIds = coworkStore.deleteSessionsByAgentId(id);

      if (deletedSessionIds.length > 0) {
        // Notify renderer to refresh session lists
        const windows = BrowserWindow.getAllWindows();
        for (const win of windows) {
          if (win.isDestroyed()) continue;
          win.webContents.send(CoworkStreamIpc.SessionsChanged, { agentId: id, deletedSessionIds });
        }
      }

      return { success: true, deleted: result };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete agent',
      };
    }
  });

  ipcMain.handle(
    'cowork:session:exportResultImage',
    async (
      event,
      options: {
        rect: { x: number; y: number; width: number; height: number };
        defaultFileName?: string;
      },
    ) => {
      try {
        const { rect, defaultFileName } = options || {};
        const captureRect = normalizeCaptureRect(rect);
        if (!captureRect) {
          return { success: false, error: 'Capture rect is required' };
        }

        const image = await event.sender.capturePage(captureRect);
        return savePngWithDialog(event.sender, image.toPNG(), defaultFileName);
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to export session image',
        };
      }
    },
  );

  ipcMain.handle(
    'cowork:session:captureImageChunk',
    async (
      event,
      options: {
        rect: { x: number; y: number; width: number; height: number };
      },
    ) => {
      try {
        const captureRect = normalizeCaptureRect(options?.rect);
        if (!captureRect) {
          return { success: false, error: 'Capture rect is required' };
        }

        const image = await event.sender.capturePage(captureRect);
        const pngBuffer = image.toPNG();

        return {
          success: true,
          width: captureRect.width,
          height: captureRect.height,
          pngBase64: pngBuffer.toString('base64'),
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to capture session image chunk',
        };
      }
    },
  );

  ipcMain.handle(
    'cowork:session:saveResultImage',
    async (
      event,
      options: {
        pngBase64: string;
        defaultFileName?: string;
      },
    ) => {
      try {
        const base64 = typeof options?.pngBase64 === 'string' ? options.pngBase64.trim() : '';
        if (!base64) {
          return { success: false, error: 'Image data is required' };
        }

        const pngBuffer = Buffer.from(base64, 'base64');
        if (pngBuffer.length <= 0) {
          return { success: false, error: 'Invalid image data' };
        }

        return savePngWithDialog(event.sender, pngBuffer, options?.defaultFileName);
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to save session image',
        };
      }
    },
  );

  ipcMain.handle(
    'cowork:session:exportText',
    async (
      event,
      options: {
        content: string;
        defaultFileName?: string;
        fileExtension?: string;
      },
    ) => {
      try {
        const content = typeof options?.content === 'string' ? options.content : '';
        if (!content) {
          return { success: false, error: 'Export content is empty' };
        }

        const ext = options?.fileExtension || 'md';
        const filterName = ext === 'json' ? 'JSON' : 'Markdown';
        const defaultName = options?.defaultFileName || `session-export.${ext}`;
        const ownerWindow = BrowserWindow.fromWebContents(event.sender);
        const saveOptions = {
          title: 'Export Session',
          defaultPath: path.join(app.getPath('downloads'), defaultName),
          filters: [{ name: filterName, extensions: [ext] }],
        };
        const saveResult = ownerWindow
          ? await dialog.showSaveDialog(ownerWindow, saveOptions)
          : await dialog.showSaveDialog(saveOptions);

        if (saveResult.canceled || !saveResult.filePath) {
          return { success: true, canceled: true };
        }

        await fs.promises.writeFile(saveResult.filePath, content, 'utf-8');
        return { success: true, canceled: false, path: saveResult.filePath };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to export session',
        };
      }
    },
  );

  ipcMain.handle(
    CoworkPermissionIpc.Respond,
    async (
      _event,
      options: {
        requestId: string;
        result: PermissionResult;
      },
    ) => {
      try {
        const runtime = getPiRuntimeAdapter();
        if (!runtime.respondToPermission(options.requestId, options.result)) {
          return { success: false, error: t('approvalRequestExpired') };
        }
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to respond to permission',
        };
      }
    },
  );

  ipcMain.handle('cowork:config:get', async () => {
    try {
      const config = getCoworkStore().getConfig();
      return { success: true, config };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get config',
      };
    }
  });

  const VALID_EMBEDDING_PROVIDERS = [
    'local',
    'openai',
    'gemini',
    'voyage',
    'mistral',
    'ollama',
  ] as const;

  function normalizeEmbeddingConfig(config: {
    embeddingEnabled?: boolean;
    embeddingProvider?: string;
    embeddingModel?: string;
    embeddingLocalModelPath?: string;
    embeddingVectorWeight?: number;
    embeddingRemoteBaseUrl?: string;
    embeddingRemoteApiKey?: string;
  }) {
    return {
      embeddingEnabled:
        typeof config.embeddingEnabled === 'boolean' ? config.embeddingEnabled : undefined,
      embeddingProvider:
        typeof config.embeddingProvider === 'string' &&
        (VALID_EMBEDDING_PROVIDERS as readonly string[]).includes(config.embeddingProvider)
          ? config.embeddingProvider
          : undefined,
      embeddingModel:
        typeof config.embeddingModel === 'string' ? config.embeddingModel.trim() : undefined,
      embeddingLocalModelPath:
        typeof config.embeddingLocalModelPath === 'string'
          ? config.embeddingLocalModelPath.trim()
          : undefined,
      embeddingVectorWeight:
        typeof config.embeddingVectorWeight === 'number' &&
        Number.isFinite(config.embeddingVectorWeight)
          ? Math.max(0, Math.min(1, config.embeddingVectorWeight))
          : undefined,
      embeddingRemoteBaseUrl:
        typeof config.embeddingRemoteBaseUrl === 'string'
          ? config.embeddingRemoteBaseUrl.trim()
          : undefined,
      embeddingRemoteApiKey:
        typeof config.embeddingRemoteApiKey === 'string'
          ? config.embeddingRemoteApiKey.trim()
          : undefined,
    };
  }

  ipcMain.handle(
    'cowork:config:set',
    async (
      _event,
      config: {
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
      },
    ) => {
      try {
        const normalizedPermissionMode =
          config.permissionMode === CoworkPermissionMode.Ask ||
          config.permissionMode === CoworkPermissionMode.AllowAll
            ? config.permissionMode
            : undefined;
        const normalizedPermissionModeBySession =
          config.permissionModeBySession && typeof config.permissionModeBySession === 'object'
            ? Object.fromEntries(
                Object.entries(config.permissionModeBySession).filter(
                  ([, value]) =>
                    value === CoworkPermissionMode.Ask || value === CoworkPermissionMode.AllowAll,
                ),
              )
            : undefined;
        const normalizedEmbedding = normalizeEmbeddingConfig(config);
        const normalizedConfig: Parameters<CoworkStore['setConfig']>[0] = {
          ...config,
          executionMode: parseCoworkExecutionMode(config.executionMode),
          permissionMode: normalizedPermissionMode,
          permissionModeBySession: normalizedPermissionModeBySession,
          ...normalizedEmbedding,
        };
        const previousConfig = getCoworkStore().getConfig();
        getCoworkStore().setConfig(normalizedConfig);
        if (normalizedPermissionModeBySession !== undefined) {
          for (const [sessionId, mode] of getChangedSessionPermissionModes(
            previousConfig.permissionModeBySession ?? {},
            normalizedPermissionModeBySession,
            normalizedPermissionMode ?? previousConfig.permissionMode,
          )) {
            getPiRuntimeAdapter().setApprovalModeForSession(
              sessionId,
              mode === CoworkPermissionMode.AllowAll
                ? ToolApprovalMode.AllowAll
                : ToolApprovalMode.Ask,
            );
          }
        }
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to set config',
        };
      }
    },
  );

  // ==================== Scheduled Task IPC Handlers (canonical SQLite + Pi) ====================

  registerActivityIpcHandlers(() => {
    activityService ??= new ActivityService(getStore().getDatabase());
    return activityService;
  });

  initCronJobServiceManager({
    getScheduledTaskService: getCanonicalScheduledTaskService,
  });
  registerScheduledTaskHandlers({ getCronJobService });

  // ==================== Permissions IPC Handlers ====================

  ipcMain.handle('permissions:checkCalendar', async () => {
    try {
      const status = await checkCalendarPermission();

      // Development mode: Auto-request permission if not determined
      // This provides a better dev experience without affecting production
      if (isDev && status === 'not-determined' && process.platform === 'darwin') {
        console.log('[Permissions] Development mode: Auto-requesting calendar permission...');
        try {
          await requestCalendarPermission();
          const newStatus = await checkCalendarPermission();
          console.log(
            '[Permissions] Development mode: Permission status after request:',
            newStatus,
          );
          return { success: true, status: newStatus, autoRequested: true };
        } catch (requestError) {
          console.warn('[Permissions] Development mode: Auto-request failed:', requestError);
        }
      }

      return { success: true, status };
    } catch (error) {
      console.error('[Main] Error checking calendar permission:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to check permission',
      };
    }
  });

  ipcMain.handle('permissions:requestCalendar', async () => {
    try {
      // Request permission and check status
      const granted = await requestCalendarPermission();
      const status = await checkCalendarPermission();
      return { success: true, granted, status };
    } catch (error) {
      console.error('[Main] Error requesting calendar permission:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to request permission',
      };
    }
  });

  ipcMain.handle('generate-session-title', async (_event, userInput: string | null) => {
    return generateSessionTitle(userInput, t('coworkDefaultSessionTitle'));
  });

  ipcMain.handle('get-recent-cwds', async (_event, limit?: number) => {
    const boundedLimit = limit ? Math.min(Math.max(limit, 1), 20) : 8;
    return getCoworkStore()
      .listRecentCwds(20)
      .filter(cwd => !isInternalWorkspacePath(cwd))
      .slice(0, boundedLimit);
  });

  // Dialog handlers
  ipcMain.handle('dialog:selectDirectory', async (event, options?: { defaultPath?: string }) => {
    const ownerWindow = BrowserWindow.fromWebContents(event.sender);
    const defaultPath = options?.defaultPath?.trim();
    const dialogOptions = {
      properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[],
      ...(defaultPath ? { defaultPath } : {}),
    };
    const result = ownerWindow
      ? await dialog.showOpenDialog(ownerWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);
    if (result.canceled || result.filePaths.length === 0) {
      return { success: true, path: null };
    }
    return { success: true, path: result.filePaths[0] };
  });

  ipcMain.handle(
    'dialog:selectFile',
    async (
      event,
      options?: { title?: string; filters?: { name: string; extensions: string[] }[] },
    ) => {
      const ownerWindow = BrowserWindow.fromWebContents(event.sender);
      const dialogOptions = {
        properties: ['openFile'] as 'openFile'[],
        title: options?.title,
        filters: options?.filters,
      };
      const result = ownerWindow
        ? await dialog.showOpenDialog(ownerWindow, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions);
      if (result.canceled || result.filePaths.length === 0) {
        return { success: true, path: null };
      }
      return { success: true, path: result.filePaths[0] };
    },
  );

  ipcMain.handle(
    'dialog:selectFiles',
    async (
      event,
      options?: { title?: string; filters?: { name: string; extensions: string[] }[] },
    ) => {
      const ownerWindow = BrowserWindow.fromWebContents(event.sender);
      const dialogOptions = {
        properties: ['openFile', 'multiSelections'] as ('openFile' | 'multiSelections')[],
        title: options?.title,
        filters: options?.filters,
      };
      const result = ownerWindow
        ? await dialog.showOpenDialog(ownerWindow, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions);
      if (result.canceled || result.filePaths.length === 0) {
        return { success: true, paths: [] };
      }
      return { success: true, paths: result.filePaths };
    },
  );

  ipcMain.handle(
    'dialog:showMessageBox',
    async (
      event,
      options: {
        message: string;
        type?: 'none' | 'info' | 'error' | 'question' | 'warning';
        title?: string;
      },
    ) => {
      const ownerWindow = BrowserWindow.fromWebContents(event.sender);
      const { dialog } = await import('electron');
      return dialog.showMessageBox(ownerWindow!, {
        type: options.type || 'warning',
        title: options.title || '',
        message: options.message,
        buttons: ['OK'],
      });
    },
  );

  ipcMain.handle(
    'dialog:saveInlineFile',
    async (
      _event,
      options?: { dataBase64?: string; fileName?: string; mimeType?: string; cwd?: string },
    ) => {
      try {
        const dataBase64 = typeof options?.dataBase64 === 'string' ? options.dataBase64.trim() : '';
        if (!dataBase64) {
          return { success: false, path: null, error: 'Missing file data' };
        }

        const buffer = Buffer.from(dataBase64, 'base64');
        if (!buffer.length) {
          return { success: false, path: null, error: 'Invalid file data' };
        }
        if (buffer.length > MAX_INLINE_ATTACHMENT_BYTES) {
          return {
            success: false,
            path: null,
            error: `File too large (max ${Math.floor(MAX_INLINE_ATTACHMENT_BYTES / (1024 * 1024))}MB)`,
          };
        }

        const dir = resolveInlineAttachmentDir(options?.cwd);
        await fs.promises.mkdir(dir, { recursive: true });

        const safeFileName = sanitizeAttachmentFileName(options?.fileName);
        const extension = inferAttachmentExtension(safeFileName, options?.mimeType);
        const baseName = extension ? safeFileName.slice(0, -extension.length) : safeFileName;
        const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const finalName = `${baseName || 'attachment'}-${uniqueSuffix}${extension}`;
        const outputPath = path.join(dir, finalName);

        await fs.promises.writeFile(outputPath, buffer);
        return { success: true, path: outputPath };
      } catch (error) {
        return {
          success: false,
          path: null,
          error: error instanceof Error ? error.message : 'Failed to save inline file',
        };
      }
    },
  );

  // Read a local file as a data URL (data:<mime>;base64,...)
  const MAX_READ_AS_DATA_URL_BYTES = 20 * 1024 * 1024;
  const MIME_BY_EXT: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.svg': 'image/svg+xml',
    '.tiff': 'image/tiff',
    '.tif': 'image/tiff',
    '.ico': 'image/x-icon',
    '.avif': 'image/avif',
  };
  registerArtifactFileAvailabilityHandler();
  ipcMain.handle(
    'dialog:readFileAsDataUrl',
    async (
      _event,
      filePath?: string,
    ): Promise<{ success: boolean; dataUrl?: string; error?: string }> => {
      try {
        if (typeof filePath !== 'string' || !filePath.trim()) {
          return { success: false, error: 'Missing file path' };
        }
        const resolvedPath = path.resolve(filePath.trim());
        const stat = await fs.promises.stat(resolvedPath);
        if (!stat.isFile()) {
          return { success: false, error: 'Not a file' };
        }
        if (stat.size > MAX_READ_AS_DATA_URL_BYTES) {
          return {
            success: false,
            error: `File too large (max ${Math.floor(MAX_READ_AS_DATA_URL_BYTES / (1024 * 1024))}MB)`,
          };
        }
        const buffer = await fs.promises.readFile(resolvedPath);
        const ext = path.extname(resolvedPath).toLowerCase();
        const mimeType = MIME_BY_EXT[ext] || 'application/octet-stream';
        const base64 = buffer.toString('base64');
        return { success: true, dataUrl: `data:${mimeType};base64,${base64}` };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to read file',
        };
      }
    },
  );

  ipcMain.handle(
    'dialog:generateThumbnail',
    async (
      _event,
      filePath?: string,
    ): Promise<{ success: boolean; dataUrl?: string; error?: string }> => {
      try {
        if (typeof filePath !== 'string' || !filePath.trim()) {
          return { success: false, error: 'Missing file path' };
        }
        const resolvedPath = path.resolve(filePath.trim());
        const stat = await fs.promises.stat(resolvedPath);
        if (!stat.isFile()) {
          return { success: false, error: 'Not a file' };
        }
        if (process.platform !== 'darwin') {
          return { success: false, error: 'Thumbnail generation only supported on macOS' };
        }
        const { execFile } = await import('child_process');
        const { promisify } = await import('util');
        const execFileAsync = promisify(execFile);
        const tmpDir = path.join(app.getPath('temp'), 'zhiyuan-thumbnails');
        await fs.promises.mkdir(tmpDir, { recursive: true });
        const baseName = path.basename(resolvedPath);
        const outputFile = path.join(tmpDir, `${baseName}.png`);
        try {
          await fs.promises.unlink(outputFile);
        } catch {
          /* ignore */
        }
        await execFileAsync('qlmanage', ['-t', '-s', '1200', '-o', tmpDir, resolvedPath]);
        const thumbBuffer = await fs.promises.readFile(outputFile);
        const base64 = thumbBuffer.toString('base64');
        try {
          await fs.promises.unlink(outputFile);
        } catch {
          /* ignore */
        }
        return { success: true, dataUrl: `data:image/png;base64,${base64}` };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to generate thumbnail',
        };
      }
    },
  );

  // Shell handlers - 打开文件/文件夹
  ipcMain.handle(ShellIpc.OpenPath, async (_event, filePath: string) => {
    try {
      const normalizedPath = normalizeWindowsShellPath(filePath);
      const result = await shell.openPath(normalizedPath);
      if (result) {
        // 如果返回非空字符串，表示打开失败
        return { success: false, error: result };
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle(ShellIpc.ShowItemInFolder, async (_event, filePath: string) => {
    try {
      const normalizedPath = normalizeWindowsShellPath(filePath);
      shell.showItemInFolder(normalizedPath);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // 2026/09/20 lixiang  供对话内本地路径高亮：仅当磁盘上存在对应文件时才可点（issue #805）
  ipcMain.handle(ShellIpc.PathExists, async (_event, filePath: string) => {
    try {
      if (typeof filePath !== 'string' || !filePath.trim()) {
        return { success: true, exists: false };
      }
      const normalizedPath = normalizeWindowsShellPath(filePath);
      return { success: true, exists: fs.existsSync(normalizedPath) };
    } catch (error) {
      return {
        success: false,
        exists: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  ipcMain.handle('shell:openExternal', async (_event, url: string) => {
    try {
      await shell.openExternal(url);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('shell:openHtmlInBrowser', async (_event, htmlContent: string) => {
    try {
      const tmpDir = path.join(os.tmpdir(), 'zhiyuan-preview');
      fs.mkdirSync(tmpDir, { recursive: true });
      const tmpFile = path.join(tmpDir, `preview-${Date.now()}.html`);
      fs.writeFileSync(tmpFile, htmlContent, 'utf-8');
      if (process.platform === 'win32') {
        const result = await shell.openPath(tmpFile);
        if (result) return { success: false, error: result };
      } else {
        await shell.openExternal(pathToFileURL(tmpFile).href);
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle(AppUpdateIpc.GetState, async () => {
    return getAppUpdateCoordinator().getState();
  });

  ipcMain.handle(AppUpdateIpc.CheckNow, async (_event, options?: { manual?: boolean }) => {
    return getAppUpdateCoordinator().checkNow(options);
  });

  ipcMain.handle(AppUpdateIpc.RetryDownload, async () => {
    const state = await getAppUpdateCoordinator().retryDownload();
    return { success: true, state };
  });

  ipcMain.handle(AppUpdateIpc.PauseDownload, async () => {
    const state = getAppUpdateCoordinator().pauseDownload();
    return { success: true, state };
  });

  ipcMain.handle(AppUpdateIpc.ResumeDownload, async () => {
    const state = getAppUpdateCoordinator().resumeDownload();
    return { success: true, state };
  });

  ipcMain.handle(AppUpdateIpc.CancelDownload, async () => {
    const state = getAppUpdateCoordinator().cancelDownload();
    return { success: true, state };
  });

  ipcMain.handle(AppUpdateIpc.InstallReady, async () => {
    if (piRuntimeAdapter?.hasRunningSessions()) {
      return {
        success: false,
        state: getAppUpdateCoordinator().getState(),
        error: t('update.activeTask'),
      };
    }
    return getAppUpdateCoordinator().installReadyUpdate();
  });

  // The downloaded installer lives in electron-updater's cache directory,
  // which is not discoverable from the UI. Reveal it in the file manager so
  // users can find, back up, or manually run the exact verified payload.
  ipcMain.handle(AppUpdateIpc.RevealDownload, async () => {
    const state = getAppUpdateCoordinator().getState();
    if (state.status !== AppUpdateStatus.Ready || !state.readyFilePath) {
      return { success: false, error: 'No downloaded update file is ready to reveal.' };
    }
    try {
      shell.showItemInFolder(state.readyFilePath);
      return { success: true, path: state.readyFilePath };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to reveal the update file.',
      };
    }
  });

  ipcMain.handle(ApiIpc.Fetch, async (_event, rawOptions: unknown) => {
    const options = ApiFetchSchema.input.parse(rawOptions);
    const shouldRecord = shouldRecordApiRequest(options.purpose);
    if (shouldRecord) {
      console.log(
        `[api:fetch] ${options.method} ${options.url}, headers: ${serializeForLog(options.headers)}, body: ${options.body}`,
      );
    }

    const doFetch = async (headers: Record<string, string>) => {
      const response = await session.defaultSession.fetch(options.url, {
        method: options.method,
        headers,
        body: options.body,
        signal: options.timeoutMs ? AbortSignal.timeout(options.timeoutMs) : undefined,
      });

      const contentType = response.headers.get('content-type') || '';
      let data: string | object;

      if (contentType.includes('text/event-stream')) {
        data = await response.text();
      } else if (contentType.includes('application/json')) {
        data = await response.json();
      } else {
        data = await response.text();
      }

      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        data,
      };
    };

    const runApiFetch = async () => {
      try {
        const result = await doFetch(options.headers);
        if (shouldRecord) {
          console.log(
            `[api:fetch] ${options.method} ${options.url} -> ${result.status} ${result.statusText}`,
            typeof result.data === 'object' ? JSON.stringify(result.data) : result.data,
          );
        }

        return result;
      } catch (error) {
        if (shouldRecord) {
          console.error(
            `[api:fetch] ${options.method} ${options.url} -> ERROR:`,
            error instanceof Error ? error.message : error,
          );
        }
        return {
          ok: false,
          status: 0,
          statusText: error instanceof Error ? error.message : 'Network error',
          headers: {},
          data: null as null,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    };

    if (!shouldRecord) return runApiFetch();

    // 2026/09/17 lixiang  开发态把主进程 api:fetch 镜像到 DevTools Network（xr-net beacon）
    return trackDevNetworkRequest({
      source: 'api-fetch',
      method: options.method,
      url: options.url,
      getStatus: result => result.status,
      getRequestBody: () => truncateNetworkBody(options.body),
      getResponseBody: result =>
        truncateNetworkBody('error' in result ? result.error : (result.data ?? result.statusText)),
      run: runApiFetch,
    });
  });

  // ─── end OAuth ───

  const isArtifactSandboxUrl = (url: string): boolean => {
    try {
      const pathname = new URL(url).pathname;
      return (
        pathname.endsWith('/artifact-react-sandbox.html') ||
        pathname.includes('/vendor/react.production.min.js') ||
        pathname.includes('/vendor/react-dom.production.min.js') ||
        pathname.includes('/vendor/babel.min.js')
      );
    } catch {
      return false;
    }
  };

  // 设置 Content Security Policy
  const setContentSecurityPolicy = () => {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      // 跳过 artifact 沙箱及其 vendor 脚本的 CSP（iframe sandbox="allow-scripts" 隔离）
      if (isArtifactSandboxUrl(details.url)) {
        callback({ responseHeaders: details.responseHeaders });
        return;
      }

      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': createContentSecurityPolicy({
            isDev,
            electronStartUrl: process.env.ELECTRON_START_URL,
          }),
        },
      });
    });
  };

  // 创建主窗口
  const createWindow = () => {
    // 如果窗口已经存在，就不再创建新窗口
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      if (!mainWindow.isFocused()) mainWindow.focus();
      return;
    }

    const initialWindowState = resolveInitialAppWindowState(
      getStore().get(AppWindowStoreKey.State),
      getDisplayWorkAreas(),
    );
    const { isMaximized: shouldRestoreMaximized, ...initialWindowBounds } = initialWindowState;

    mainWindow = new BrowserWindow({
      ...initialWindowBounds,
      title: runtimeAppName,
      icon: getAppIconPath(),
      ...(isMac
        ? {
            titleBarStyle: 'hiddenInset' as const,
            trafficLightPosition: { x: 12, y: 20 },
          }
        : isWindows
          ? {
              frame: false,
              titleBarStyle: 'hidden' as const,
            }
          : {
              titleBarStyle: 'hidden' as const,
              titleBarOverlay: getTitleBarOverlayOptions(),
            }),
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        // 2026/09/17 lixiang  开发环境关闭 webSecurity，页面 fetch 才能跨域并出现在 DevTools Network
        webSecurity: !isDev,
        preload: PRELOAD_PATH,
        // 2026/09/21 lixiang  恢复 Chromium 默认节流：窗口隐藏/最小化后暂停渲染进程定时器与动画，
        // 降低常驻内存与 CPU（下载、流式对话均在主进程完成，不受影响）。
        backgroundThrottling: true,
        devTools: isDev,
        spellcheck: false,
        enableWebSQL: false,
        autoplayPolicy: 'document-user-activation-required',
        disableDialogs: true,
        navigateOnDragDrop: false,
      },
      backgroundColor: getInitialTheme() === 'dark' ? '#0F1117' : '#F8F9FB',
      show: isLinuxRendererSmoke,
      autoHideMenuBar: true,
      enableLargerThanScreen: false,
    });

    // Windows 任务栏在设置 AppUserModelID 后仍要显式套用 ico，否则继续显示 Electron 图标
    applyWindowsWindowIcon(mainWindow);

    // 设置 macOS Dock 图标（开发模式下 Electron 默认图标不是应用 Logo）
    if (isMac && isDev) {
      // Use a PNG with extra transparent padding. NativeImage reliably loads
      // this in development and it keeps the Dock visual size below the
      // packaged app's full-bleed icon.
      const iconPath = path.join(__dirname, '../build/icons/png/mac-dev-dock.png');
      if (fs.existsSync(iconPath)) {
        app.dock.setIcon(nativeImage.createFromPath(iconPath));
      }
    }

    // 禁用窗口菜单
    mainWindow.setMenu(null);
    const unregisterContextMenu = registerContextMenu(mainWindow);

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url);
      return { action: 'deny' };
    });

    // 设置窗口的最小尺寸
    mainWindow.setMinimumSize(MIN_APP_WINDOW_WIDTH, MIN_APP_WINDOW_HEIGHT);
    if (shouldRestoreMaximized) {
      mainWindow.maximize();
    }

    // 设置窗口加载超时
    const loadTimeout = setTimeout(() => {
      if (mainWindow && mainWindow.webContents.isLoadingMainFrame()) {
        console.log('Window load timed out, attempting to reload...');
        scheduleReload('load-timeout');
      }
    }, 30000);

    // 清除超时
    mainWindow.webContents.once('did-finish-load', () => {
      clearTimeout(loadTimeout);
    });
    mainWindow.webContents.on('did-finish-load', () => {
      emitWindowState();
    });

    // 处理窗口关闭
    mainWindow.on('close', e => {
      if (windowStateSaveTimer) {
        clearTimeout(windowStateSaveTimer);
        windowStateSaveTimer = null;
      }
      persistAppWindowState();

      // In development, close should actually quit so `npm run electron:dev`
      // restarts from a clean process. In production we keep tray behavior.
      if (mainWindow && !isQuitting && !isDev) {
        e.preventDefault();
        mainWindow.hide();
      }
    });

    if (isDev) {
      // 开发环境
      const maxRetries = 3;
      let retryCount = 0;

      const tryLoadURL = () => {
        mainWindow?.loadURL(DEV_SERVER_URL).catch(err => {
          console.error('Failed to load URL:', err);
          retryCount++;

          if (retryCount < maxRetries) {
            console.log(`Retrying to load URL (${retryCount}/${maxRetries})...`);
            setTimeout(tryLoadURL, 3000);
          } else {
            console.error('Failed to load URL after maximum retries');
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.loadFile(path.join(__dirname, '../resources/error.html'));
            }
          }
        });
      };

      tryLoadURL();

      // 开发环境默认在窗口右侧打开 DevTools；关闭后可用 F12 / Ctrl+Shift+I
      const openDevToolsIfNeeded = () => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        openDevToolsWindow(mainWindow.webContents);
      };
      // Wait until the page is ready so the docked panel is attached to a live view.
      mainWindow.webContents.once('did-finish-load', () => {
        setTimeout(openDevToolsIfNeeded, 300);
      });
      mainWindow.webContents.on('before-input-event', (event, input) => {
        if (input.type !== 'keyDown') return;
        const isToggleShortcut =
          input.key === 'F12' ||
          ((input.control || input.meta) && input.shift && input.key.toLowerCase() === 'i');
        if (!isToggleShortcut) return;
        event.preventDefault();
        toggleDevToolsForSender(mainWindow?.webContents);
      });
    } else {
      // 生产环境
      mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    }

    // 添加错误处理
    mainWindow.webContents.on(
      'did-fail-load',
      (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        if (!isMainFrame) return;
        console.error('Page failed to load:', errorCode, errorDescription);
        // 如果加载失败，尝试重新加载
        if (isDev) {
          setTimeout(() => {
            scheduleReload('did-fail-load');
          }, 3000);
        }
      },
    );

    // 当窗口关闭时，清除引用
    mainWindow.on('closed', () => {
      unregisterContextMenu();
      if (windowStateSaveTimer) {
        clearTimeout(windowStateSaveTimer);
        windowStateSaveTimer = null;
      }
      mainWindow = null;
    });

    const forwardWindowState = () => emitWindowState();
    const forwardAndPersistWindowState = () => {
      emitWindowState();
      schedulePersistAppWindowState();
    };
    mainWindow.on('resize', schedulePersistAppWindowState);
    mainWindow.on('move', schedulePersistAppWindowState);
    mainWindow.on('maximize', forwardAndPersistWindowState);
    mainWindow.on('unmaximize', forwardAndPersistWindowState);
    mainWindow.on('enter-full-screen', forwardAndPersistWindowState);
    mainWindow.on('leave-full-screen', forwardAndPersistWindowState);
    mainWindow.on('focus', forwardWindowState);
    mainWindow.on('blur', forwardWindowState);
    mainWindow.on('session-end', () => {
      recordAppQuitOrigin(AppQuitOrigin.OperatingSystemSessionEnd);
      logAppQuitContextOnce();
    });

    // Some Linux desktop/GPU combinations finish loading without emitting ready-to-show.
    // Show the loaded window so the first launch does not remain hidden until a second click.
    mainWindow.webContents.once('did-finish-load', () => {
      if (
        mainWindow &&
        !mainWindow.isDestroyed() &&
        !mainWindow.isVisible() &&
        (isLinuxRendererSmoke || !isAutoLaunched())
      ) {
        console.warn(
          '[MainWindow] Page loaded before ready-to-show; showing the initial window now.',
        );
        mainWindow.show();
      }
    });

    // 等待内容加载完成后再显示窗口
    mainWindow.once('ready-to-show', () => {
      // 2026/09/20 lixiang  显示前再套一次图标，避免 Windows 任务栏仍缓存 electron 默认图标
      if (mainWindow && !mainWindow.isDestroyed()) {
        applyWindowsWindowIcon(mainWindow);
      }
      emitWindowState();
      // 开机自启时不显示窗口，仅显示托盘图标
      if (isLinuxRendererSmoke || !isAutoLaunched()) {
        mainWindow?.show();
        if (mainWindow && !mainWindow.isDestroyed()) {
          applyWindowsWindowIcon(mainWindow);
        }
      }
      // Initialize main-process i18n from stored language before creating UI elements.
      const initLang = getStore().get<{ language?: string }>('app_config')?.language;
      setLanguage(initLang === 'en' ? 'en' : 'zh');
      // 窗口就绪后创建系统托盘
      createTray(() => mainWindow);

      // Start cron polling after the window is ready.
      (async () => {
        try {
          getCronJobService().startPolling();
        } catch (err) {
          console.warn('[Main] Canonical scheduler not available yet:', err);
        }
      })();
    });
  };

  let isCleanupFinished = false;
  let isCleanupInProgress = false;
  let hasLoggedAppQuitContext = false;

  const logAppQuitContextOnce = (): void => {
    if (hasLoggedAppQuitContext) return;
    hasLoggedAppQuitContext = true;

    const origin = getAppQuitOrigin();
    const windowCount = BrowserWindow.getAllWindows().length;
    const appImageContext = process.env.APPIMAGE ? ` from AppImage ${process.env.APPIMAGE}` : '';
    console.log(
      `[AppLifecycle] Quit requested by ${origin} on ${process.platform} with ${windowCount} open window(s) ` +
        `(pid ${process.pid}, executable ${process.execPath}${appImageContext}).`,
    );
  };

  const runAppCleanup = async (): Promise<void> => {
    console.log('[AppLifecycle] App cleanup started.');
    await historyService?.dispose();
    historyService = undefined;
    historyIndexDb?.close();
    historyIndexDb = undefined;
    destroyTray();

    // Stop the cron job polling
    try {
      getCronJobService().stopPolling();
    } catch {
      // The canonical scheduler may not have been initialized — safe to ignore.
    }

    // Stop all active Pi sessions without blocking shutdown.
    console.log('[Main] Stopping cowork sessions...');
    if (piRuntimeAdapter) await piRuntimeAdapter.close();
    await shutdownPythonRuntime();
    // Persist native checkpoints before closing the gateway used by active requests.
    await disposeMagpie?.();
    disposeMagpie = undefined;

    await disposeZhiyuanEnterpriseExtension().catch(error => {
      console.error('[EnterpriseExtension] Failed to dispose enterprise extension:', error);
    });

    disposeMagpieModels?.();
    disposeMagpieModels = undefined;

    if (ollamaManager) {
      await ollamaManager.shutdownForQuit().catch(error => {
        console.error('[Ollama] Failed to stop service on quit:', error);
      });
    }

    if (llamaCppManager) {
      await llamaCppManager.shutdownForQuit().catch(error => {
        console.error('[LlamaCpp] Failed to stop service on quit:', error);
      });
    }

    if (llamaCppModelDaemonController) {
      await llamaCppModelDaemonController.shutdownForQuit().catch(error => {
        console.error('[LlamaCppDaemon] Failed to stop local inference daemon on quit:', error);
      });
    }

    if (codingRoomService) {
      await codingRoomService.dispose().catch(error => {
        console.error('[CodingRoom] Failed to dispose coding agent connections on quit:', error);
      });
    }

    sqliteBackupManager?.stopPeriodicBackupLoop();
    todoReminderScheduler?.stop();
    todoReminderScheduler = null;

    // Close the SQLite database to flush the WAL and release the file lock.
    try {
      getStore().close();
    } catch {
      // Store may not have been initialized — safe to ignore.
    }
  };

  app.on('before-quit', e => {
    if (isCleanupFinished) return;

    e.preventDefault();
    if (isCleanupInProgress) {
      return;
    }

    logAppQuitContextOnce();
    isCleanupInProgress = true;
    isQuitting = true;

    // The cleanup chain stops many services sequentially with no per-service
    // deadline; a single wedged stop used to block app.exit(0) forever, which
    // on Windows turned update installs into an installer racing a live old
    // process. Bound the whole chain: whatever finishes first wins.
    const APP_QUIT_CLEANUP_TIMEOUT_MS = 15_000;
    const cleanupDeadline = new Promise<void>(resolve =>
      setTimeout(resolve, APP_QUIT_CLEANUP_TIMEOUT_MS).unref?.(),
    );

    void Promise.race([runAppCleanup(), cleanupDeadline])
      .catch(error => {
        console.error('[Main] Cleanup error:', error);
      })
      .finally(() => {
        if (isCleanupFinished) return;
        isCleanupFinished = true;
        isCleanupInProgress = false;
        console.log('[Main] App cleanup finished or timed out; exiting for quit.');
        app.exit(0);
      });
  });

  const handleTerminationSignal = (signal: NodeJS.Signals, origin: AppQuitOrigin) => {
    if (isCleanupFinished || isCleanupInProgress) {
      return;
    }
    recordAppQuitOrigin(origin);
    logAppQuitContextOnce();
    console.log(`[AppLifecycle] Received ${signal}; running cleanup before exit.`);
    isCleanupInProgress = true;
    isQuitting = true;
    void runAppCleanup()
      .catch(error => {
        console.error(`[Main] Cleanup error during ${signal}:`, error);
      })
      .finally(() => {
        isCleanupFinished = true;
        isCleanupInProgress = false;
        app.exit(0);
      });
  };

  process.once('SIGINT', () => handleTerminationSignal('SIGINT', AppQuitOrigin.SignalInterrupt));
  process.once('SIGTERM', () => handleTerminationSignal('SIGTERM', AppQuitOrigin.SignalTerminate));

  // 初始化应用
  const initApp = async () => {
    const profiler = new StartupProfiler();

    profiler.mark('app.whenReady');
    console.log('[Main] initApp: waiting for app.whenReady()');
    await app.whenReady();
    profiler.measure('app.whenReady');
    console.log('[Main] initApp: app is ready');
    // The single-instance lock is held; no database, native owner or timer may open before this.
    await runPendingHistoryMaintenance(app.getPath('userData'));
    restoredNativeGuard = await loadRestoredNativeGuard(app.getPath('userData'));
    // 开发态写入带知远 .ico 的开始菜单快捷方式，任务栏按 AUMID 取图标。
    ensureWindowsTaskbarBrand();

    protocol.handle(ZHIYUAN_ENTERPRISE_RENDERER_SCHEME, async request => {
      const assetPath = zhiyuanEnterpriseRendererBridge.resolveAsset(request.url);
      if (!assetPath) return new Response(null, { status: 404 });
      const response = await net.fetch(pathToFileURL(assetPath).toString());
      return allowEnterpriseRendererOpaqueOrigin(response);
    });

    const enterpriseExtension = await initializeZhiyuanEnterpriseExtension({
      appVersion: app.getVersion(),
      isPackaged: app.isPackaged,
      platform: process.platform,
      resourcesPath: process.resourcesPath,
      userDataPath: app.getPath('userData'),
      developmentExtensionPath: process.env.ZHIYUAN_ENTERPRISE_EXTENSION_DEV_PATH,
      sessionCapability: zhiyuanEnterpriseSessionBridge,
      managedProviderCapability: zhiyuanManagedProviderBridge,
      createRendererCapability: extensionDirectory =>
        zhiyuanEnterpriseRendererBridge.createScopedCapability(extensionDirectory),
      createSettingsCapability: extensionDirectory =>
        zhiyuanEnterpriseRendererBridge.createScopedSettingsCapability(extensionDirectory),
    });
    if (enterpriseExtension.extensionId) {
      console.log(
        `[EnterpriseExtension] Initialized ${enterpriseExtension.extensionId} with API version 1.`,
      );
    }

    // Note: Calendar permission is checked on-demand when calendar operations are requested
    // We don't trigger permission dialogs at startup to avoid annoying users

    // Ensure default working directory exists
    const defaultProjectDir = path.join(os.homedir(), 'zhiyuan', 'project');
    if (!fs.existsSync(defaultProjectDir)) {
      fs.mkdirSync(defaultProjectDir, { recursive: true });
      console.log('Created default project directory:', defaultProjectDir);
    }
    console.log('[Main] initApp: default project dir ensured');

    // 注册 localfile:// 自定义协议，用于安全加载本地文件（图片等）
    protocol.handle('localfile', request => {
      const url = new URL(request.url);
      const filePath = decodeURIComponent(url.pathname);
      return net.fetch(`file://${filePath}`);
    });
    // 2026/09/17 lixiang  仅开发态挂 Network 镜像，避免生产 clone 响应体
    if (isDev) {
      registerDevNetworkProtocol();
      setPlatformFetchNetworkLogger(publishDevNetworkLog);
    }

    profiler.mark('initStore');
    console.log('[Main] initApp: starting initStore()');
    store = await initStore();
    startSqliteDiagnostics({
      db: store.getDatabase(),
      dbPath: path.join(app.getPath('userData'), DB_FILENAME),
    });
    profiler.measure('initStore');
    console.log('[Main] initApp: store initialized');
    initializeHistoryService();
    sqliteBackupManager = new SqliteBackupManager(app.getPath('userData'));
    const startSqliteBackupLoop = async (): Promise<void> => {
      if (!sqliteBackupManager) return;
      await sqliteBackupManager.startPeriodicBackupLoop(() => getStore().getDatabase());
    };

    const stopSqliteBackupLoop = (): void => {
      sqliteBackupManager?.stopPeriodicBackupLoop();
    };

    if (getSqliteAutoBackupEnabledFromConfig(getStore().get<AppConfigSettings>('app_config'))) {
      await startSqliteBackupLoop().catch(error => {
        console.error('[SqliteBackup] Failed to start periodic backup loop:', error);
      });
    }

    // Defensive recovery: app may be force-closed during execution and leave
    // stale running flags in DB. Normalize them on startup.
    const resetCount = getCoworkStore().resetRunningSessions();
    console.log('[Main] initApp: resetRunningSessions done, count:', resetCount);
    if (resetCount > 0) {
      console.log(`[Main] Reset ${resetCount} stuck cowork session(s) from running -> idle`);
    }
    activityService ??= new ActivityService(getStore().getDatabase());
    const recoveredActivityRuns = activityService.recoverInterruptedRuns();
    if (recoveredActivityRuns > 0) {
      console.warn(
        `[Activity] marked ${recoveredActivityRuns} interrupted activity run(s) as failed`,
      );
    }
    const prunedActivityRuns = activityService.pruneExpired();
    if (prunedActivityRuns > 0) {
      console.log(`[Activity] removed ${prunedActivityRuns} expired activity run(s)`);
    }
    todoReminderScheduler = new TodoReminderScheduler(getStore().getDatabase());
    todoReminderScheduler.start();
    registerTodoIpcHandlers(() => getStore().getDatabase(), {
      onMutation: () => todoReminderScheduler?.refresh(),
    });
    registerCodingAgentIpcHandlers(getCodingRoomService);
    const recoveredCodingLanes = getCodingRoomService().recoverInterruptedState();
    if (recoveredCodingLanes > 0) {
      console.warn(
        `[CodingAgent] recovered ${recoveredCodingLanes} interrupted lane(s) after restart`,
      );
    }
    void getCodingRoomService()
      .registry.discoverExternalAgents()
      .catch(error => {
        console.warn('[CodingAgent] External ACP discovery failed:', error);
      });
    const localInferenceManager = getLlamaCppManager();
    localInferenceManager.initializeModelsDir();
    llamaCppModelDaemonController = registerLlamaCppIpcHandlers(localInferenceManager, {
      getStore,
      onModelBindingsChanged: async (url, models) => {
        managedMagpieBindings?.setGpuSnapshot(url, models);
        if (magpieManager?.status().state === 'running') await managedMagpieBindings?.synchronize();
      },
    });
    // Warm the short-lived backend cache before the runtime settings dialog is opened.
    void localInferenceManager.listBackends();
    registerTriageIpcHandlers({ getStore });
    registerOllamaIpcHandlers(getOllamaManager(), {
      getStore,
      onModelBindingsChanged: async snapshot => {
        managedMagpieBindings?.setOllamaSnapshot(snapshot);
        if (magpieManager?.status().state === 'running') await managedMagpieBindings?.synchronize();
      },
    });
    registerMarketplaceIpcHandlers({
      getModelsDir: () => getLlamaCppManager().getModelsDir(),
      userDataPath: app.getPath('userData'),
    });
    // Enterprise config sync must run before agent services initialize.
    profiler.mark('enterpriseConfigSync');
    // so enterprise data is in SQLite when the config is generated.
    const enterpriseConfigPath = resolveEnterpriseConfigPath();
    if (enterpriseConfigPath) {
      try {
        syncEnterpriseConfig(enterpriseConfigPath, store, () => {
          const cs = getCoworkStore();
          return cs.getConfig().workingDirectory;
        });
      } catch (error) {
        console.error('[Enterprise] config sync failed:', error);
      }
    } else {
      // No enterprise config package found — clear any previously stored config
      // so the app exits enterprise mode after the package is removed.
      const hadEnterprise = store.get('enterprise_config');
      if (hadEnterprise) {
        store.delete('enterprise_config');
        // Restore the default execution mode after removing enterprise configuration.
        const cs = getCoworkStore();
        cs.setConfig({ executionMode: CoworkExecutionMode.Local });
        console.log(
          '[Enterprise] config package removed, cleared enterprise mode and reset executionMode',
        );
      }
    }
    profiler.measure('enterpriseConfigSync');

    bindPiWorkbenchRuntimeForwarder();

    profiler.mark('applyProxyPreference');
    const appConfig = getStore().get<AppConfigSettings>('app_config');
    await applyProxyPreference(getUseSystemProxyFromConfig(appConfig));
    profiler.measure('applyProxyPreference');
    if (getStore().get<boolean>('magpie_service_enabled') === true) {
      await magpieManager?.ensureRunning().catch(error => {
        console.warn('[Magpie] Previously enabled model service could not start:', error);
      });
    }

    try {
      getCronJobService().startPolling();
    } catch (error) {
      console.warn('[Main] Canonical scheduler not available after startup:', error);
    }

    // ── Step 1: Show window ASAP ──────────────────────────────────────
    setContentSecurityPolicy();

    profiler.mark('createWindow');
    console.log('[Main] initApp: creating window');
    createWindow();
    profiler.measure('createWindow');
    console.log('[Main] initApp: window created');
    startAppUpdatePolling();

    console.log(profiler.summary());

    // Windows/Linux cold start: parse deep link from process.argv
    // Always buffer since renderer is not ready yet after createWindow()
    const coldStartDeepLink = process.argv.find(arg => arg.startsWith('zhiyuan://'));
    if (coldStartDeepLink) {
      handleDeepLink(coldStartDeepLink);
    }

    powerMonitor.on('resume', () => {
      if (Date.now() - lastSuccessfulAppUpdateCheckAt >= APP_UPDATE_POLL_INTERVAL_MS) {
        checkForAppUpdate();
      }
    });

    // 首次启动时默认开启开机自启动（先写标记再设置，避免崩溃后重复设置）
    if (!getStore().get('auto_launch_initialized')) {
      getStore().set('auto_launch_initialized', true);
      getStore().set('auto_launch_enabled', true);
      setAutoLaunchEnabled(true);
    }

    // Restore prevent-sleep setting
    const preventSleepEnabled = getStore().get<boolean>('prevent_sleep_enabled');
    if (preventSleepEnabled) {
      try {
        setPreventSleepBlockerEnabled(true);
      } catch (err) {
        console.error('[Main] Failed to start prevent-sleep blocker:', err);
      }
    }

    let lastLanguage = getStore().get<AppConfigSettings>('app_config')?.language;
    let lastUseSystemProxy = getUseSystemProxyFromConfig(
      getStore().get<AppConfigSettings>('app_config'),
    );
    let lastSqliteAutoBackupEnabled = getSqliteAutoBackupEnabledFromConfig(
      getStore().get<AppConfigSettings>('app_config'),
    );
    getStore().onDidChange<AppConfigSettings>('app_config', (newConfig, oldConfig) => {
      updateTitleBarOverlay();
      // 仅在语言变更时刷新托盘菜单文本
      const currentLanguage = newConfig?.language;
      if (currentLanguage !== lastLanguage) {
        lastLanguage = currentLanguage;
        setLanguage(currentLanguage === 'en' ? 'en' : 'zh');
        updateTrayMenu(() => mainWindow);
      }

      const previousUseSystemProxy = oldConfig
        ? getUseSystemProxyFromConfig(oldConfig)
        : lastUseSystemProxy;
      const currentUseSystemProxy = getUseSystemProxyFromConfig(newConfig);
      if (currentUseSystemProxy !== previousUseSystemProxy) {
        console.log(
          `[Proxy] system proxy preference changed from ${previousUseSystemProxy} to ${currentUseSystemProxy}`,
        );
        void applyProxyPreference(currentUseSystemProxy);
      }
      lastUseSystemProxy = currentUseSystemProxy;

      const previousSqliteAutoBackupEnabled = oldConfig
        ? getSqliteAutoBackupEnabledFromConfig(oldConfig)
        : lastSqliteAutoBackupEnabled;
      const currentSqliteAutoBackupEnabled = getSqliteAutoBackupEnabledFromConfig(newConfig);
      if (currentSqliteAutoBackupEnabled !== previousSqliteAutoBackupEnabled) {
        if (currentSqliteAutoBackupEnabled) {
          void startSqliteBackupLoop().catch(error => {
            console.error('[SqliteBackup] Failed to enable periodic backup loop:', error);
          });
        } else {
          stopSqliteBackupLoop();
        }
      }
      lastSqliteAutoBackupEnabled = currentSqliteAutoBackupEnabled;
    });

    // 在 macOS 上，当点击 dock 图标时显示已有窗口或重新创建
    app.on('activate', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (!mainWindow.isVisible()) mainWindow.show();
        if (!mainWindow.isFocused()) mainWindow.focus();
        return;
      }
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  };

  // 启动应用
  initApp().catch(console.error);

  // 当所有窗口关闭时退出应用
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      recordAppQuitOrigin(AppQuitOrigin.WindowAllClosed);
      app.quit();
    }
  });
}
