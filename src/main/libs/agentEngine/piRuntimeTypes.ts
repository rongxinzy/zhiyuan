import type { CoworkError } from '../../../common/coworkError';
import type { RuntimeRetryNotice } from '../../../common/runtimeNotice';
import type { CoworkMessage } from '../../coworkStore';
import type { CoworkPendingMessage } from '../../../shared/cowork/pendingMessageQueue';
import type { ToolApprovalMode } from '../../../shared/cowork/approval';

/**
 * Pi-native workbench runtime types (issue #225).
 *
 * Pi is the sole execution kernel for Work, Chat, Channel and Cron runs and
 * owns its session, event and approval types. Shared payload primitives
 * come from the store and shared layers instead of a second runtime abstraction.
 */

export type PiPermissionResult =
  | {
      behavior: 'allow';
      updatedInput?: Record<string, unknown>;
      updatedPermissions?: Record<string, unknown>[];
      toolUseID?: string;
    }
  | {
      behavior: 'deny';
      message: string;
      interrupt?: boolean;
      toolUseID?: string;
    };

export interface PiPermissionRequest {
  requestId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  toolUseId?: string | null;
}

export const NativeStopCause = {
  UserStop: 'user_stop',
  ApprovalDenied: 'approval_denied',
} as const;
export interface NativeStopReceipt {
  submissionId: number;
  cause: (typeof NativeStopCause)[keyof typeof NativeStopCause];
}

export interface PiRuntimeEvents {
  workDocumentChanged: (
    event: import('../../../shared/durable/workDocument').WorkDocumentChanged,
  ) => void;
  started: (sessionId: string) => void;
  message: (sessionId: string, message: CoworkMessage) => void;
  messageUpdate: (
    sessionId: string,
    messageId: string,
    content: string,
    metadata?: Record<string, unknown>,
  ) => void;
  permissionRequest: (sessionId: string, request: PiPermissionRequest) => void;
  permissionDismiss: (requestId: string) => void;
  complete: (sessionId: string) => void;
  error: (sessionId: string, error: CoworkError) => void;
  /**
   * Pi is retrying a failed attempt. Transient by nature: the renderer shows it
   * as a shared prompt and never persists it.
   */
  nativeRetry: (
    sessionId: string,
    notice: Omit<RuntimeRetryNotice, 'sessionId'> & { retryAt: number },
  ) => void;
  sessionStopped: (sessionId: string, receipt: NativeStopReceipt) => void;
  queueUpdated: (sessionId: string, items: CoworkPendingMessage[]) => void;
}

/** Thinking levels supported by the Pi runtime (pi-agent-core ThinkingLevel). */
export const PiThinkingLevel = {
  Off: 'off',
  Minimal: 'minimal',
  Low: 'low',
  Medium: 'medium',
  High: 'high',
  XHigh: 'xhigh',
  Max: 'max',
} as const;
export type PiThinkingLevel = (typeof PiThinkingLevel)[keyof typeof PiThinkingLevel];

export type PiImageAttachment = {
  name: string;
  mimeType: string;
  /** Present only for the in-flight model request. Persisted copies keep `path`. */
  base64Data?: string;
  path?: string;
};

export type PiStartOptions = {
  requestId?: string;
  skipInitialUserMessage?: boolean;
  /** Existing UI projection for an input durably admitted next. */
  _userMessageId?: string;
  /** Execution skill set for this session (user selection plus expert preset). */
  skillIds?: string[];
  systemPrompt?: string;
  approvalMode?: ToolApprovalMode;
  /** No foreground user is available to answer questions during this run. */
  unattended?: boolean;
  workspaceRoot?: string;
  confirmationMode?: 'modal' | 'text';
  /** UI session mode, used to apply Work-only execution controls. */
  sessionMode?: 'work' | 'chat';
  goalMode?: boolean;
  imageAttachments?: PiImageAttachment[];
  fileAttachments?: Array<{ name: string; path: string; extension: string; isImage?: boolean }>;
  agentId?: string;
  expertIds?: string[];
  modelOverride?: string;
  /** Pi thinking level applied when the session is (re)created. */
  thinkingLevel?: PiThinkingLevel;
};

export type PiContinueOptions = {
  requestId?: string;
  systemPrompt?: string;
  /** Execution skill set for this turn (user selection plus expert preset). */
  skillIds?: string[];
  /** UI session mode, preserved when a skill change recreates the Pi session. */
  sessionMode?: 'work' | 'chat';
  goalMode?: boolean;
  imageAttachments?: PiImageAttachment[];
  fileAttachments?: Array<{ name: string; path: string; extension: string; isImage?: boolean }>;
  /** Session snapshot used when the in-process runtime needs to recreate Pi state. */
  workspaceRoot?: string;
  agentId?: string;
  expertIds?: string[];
  modelOverride?: string;
  /** Forwarded to startSession when the runtime has to recreate the session. */
  thinkingLevel?: PiThinkingLevel;
  /** Forwarded to startSession when the runtime has to recreate the session. */
  approvalMode?: ToolApprovalMode;
  /** No foreground user is available to answer questions during this run. */
  unattended?: boolean;
  /** Internal: do not persist a synthetic Resume/Retry prompt as a user message. */
  _skipUserMessage?: boolean;
  /** Internal: tells Pi how to queue a prompt while the agent is settling. */
  _streamingBehavior?: 'steer' | 'followUp';
};

/** Workbench session patch; Pi supports switching the model and thinking level. */
export type PiSessionPatch = {
  model?: string | null;
  thinkingLevel?: PiThinkingLevel | null;
};

export interface PiRuntime {
  on<U extends keyof PiRuntimeEvents>(event: U, listener: PiRuntimeEvents[U]): this;
  off<U extends keyof PiRuntimeEvents>(event: U, listener: PiRuntimeEvents[U]): this;
  startSession(sessionId: string, prompt: string, options?: PiStartOptions): Promise<void>;
  cancelScheduledTask(sessionId: string): Promise<void>;
  runScheduledTask(
    sessionId: string,
    prompt: string,
    options: PiStartOptions & { requestId: string },
  ): Promise<{ submissionId: number; conversationId: number }>;
  continueSession(sessionId: string, prompt: string, options?: PiContinueOptions): Promise<void>;
  patchSession?(sessionId: string, patch: PiSessionPatch): Promise<void>;
  stopSession(sessionId: string): void | Promise<void>;
  stopAllSessions(): void;
  respondToPermission(requestId: string, result: PiPermissionResult): boolean;
  isSessionActive(sessionId: string): boolean;
  isSessionRunning(sessionId: string): boolean;
  /** Compacts an idle Pi session without turning the action into model input. */
  compactSession(sessionId: string): Promise<{ cancelled: boolean }>;
  /** Runs an application-owned action after already queued Work prompts settle. */
  enqueueControlAction(
    sessionId: string,
    action: () => Promise<void>,
  ): { success: boolean; error?: string };
  listPendingMessages(sessionId: string): CoworkPendingMessage[];
  enqueuePendingMessage(
    sessionId: string,
    text: string,
    imageAttachments?: PiImageAttachment[],
    fileAttachments?: Array<{ name: string; path: string; extension: string; isImage?: boolean }>,
    requestId?: string,
  ): Promise<{ success: boolean; item?: CoworkPendingMessage; error?: string }>;
  updatePendingMessage(
    sessionId: string,
    itemId: string,
    text: string,
  ): Promise<{ success: boolean; item?: CoworkPendingMessage; error?: string }>;
  deletePendingMessage(
    sessionId: string,
    itemId: string,
  ): Promise<{ success: boolean; error?: string }>;
  steerPendingMessage(
    sessionId: string,
    itemId: string,
  ): Promise<{ success: boolean; item?: CoworkPendingMessage; error?: string }>;
  followUpPendingMessage(
    sessionId: string,
    itemId: string,
  ): Promise<{ success: boolean; item?: CoworkPendingMessage; error?: string }>;
  getSessionConfirmationMode(sessionId: string): 'modal' | 'text' | null;
  onSessionDeleted?(sessionId: string): void;
}

/** The host closed; persisted native work has not reached a terminal state. */
export class DurableWorkDetachedError extends Error {
  constructor() {
    super('Work remains saved while the application is closed.');
    this.name = 'DurableWorkDetachedError';
  }
}
