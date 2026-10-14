import { randomUUID } from 'crypto';

import {
  CodingErrorMessage,
  type CodingAgentAvailableCommand,
  type CodingAgentCapabilities,
  type CodingAgentConfigOption,
  type CodingEvent,
  type CodingPermissionResponse,
} from '../../../shared/codingAgent';
import { t } from '../../i18n';
import { ToolApprovalMode } from '../../../shared/cowork/approval';
import { PiThinkingLevel } from '../../libs/agentEngine/piRuntimeTypes';
import type {
  CodingAgentAuthRequest,
  CodingAgentAuthState,
  CodingAgentDriver,
  CodingAgentSession,
} from './codingAgentDriver';
import {
  buildBuiltinCodingCommandList,
  EMPTY_BUILTIN_CODING_COMMAND_CHOICES,
  parseBuiltinCodingPrompt,
  type BuiltinCodingCommandChoices,
  type ParsedBuiltinCodingSelection,
} from './builtinCodingCommands';

export const BuiltinCodingConfigId = {
  ThinkingLevel: 'thinking-level',
  PermissionMode: 'permission-mode',
} as const;
export type BuiltinCodingConfigId =
  (typeof BuiltinCodingConfigId)[keyof typeof BuiltinCodingConfigId];

export interface BuiltinCodingSessionStartOptions {
  modelOverride?: string | null;
  thinkingLevel?: string;
  permissionMode?: ToolApprovalMode;
  /** Experts the lane runs with; an empty list clears the current selection. */
  expertIds?: string[];
}

export interface BuiltinCodingRuntime {
  start(
    sessionId: string,
    workspaceRoot: string,
    prompt: string,
    options?: BuiltinCodingSessionStartOptions,
  ): Promise<void>;
  cancel(sessionId: string): Promise<void>;
  /** Installed experts advertised with the command snapshot. */
  listCommandChoices?(): BuiltinCodingCommandChoices;
  /** Bumped when those installed choices change; a newer value re-reads them. */
  commandCatalogGeneration?(): number;
  /** Applies thinking-level changes to a live Pi session. */
  patchSession?(
    sessionId: string,
    patch: { model?: string | null; thinkingLevel?: string | null },
  ): Promise<void>;
  /** Applies approval-mode changes to a live Pi session. */
  setApprovalMode?(sessionId: string, mode: ToolApprovalMode): void;
}

const BUILTIN_CAPABILITIES: CodingAgentCapabilities = {
  // The in-process runtime owns its transcript and cannot re-attach to a
  // session id after a restart, so it never claims load-session support.
  supportsLoadSession: false,
  supportsResumeSession: true,
  supportsPlans: false,
  supportsPermissions: true,
  supportsFilesystem: true,
  supportsTerminal: true,
  supportsConfigOptions: true,
  supportsUsage: true,
  supportsElicitation: false,
};

const THINKING_LEVEL_OPTIONS = Object.values(PiThinkingLevel).map(level => ({
  value: level,
  name: level,
}));

const isValidThinkingLevel = (value: string): value is PiThinkingLevel =>
  (Object.values(PiThinkingLevel) as string[]).includes(value);

const isValidApprovalMode = (value: string): value is ToolApprovalMode =>
  (Object.values(ToolApprovalMode) as string[]).includes(value);

/**
 * `/expert` carries the selected id into the runtime options. An
 * explicit empty list clears the selection; an absent field keeps it.
 */
const selectionOptions = (
  selection: ParsedBuiltinCodingSelection | undefined,
): Partial<BuiltinCodingSessionStartOptions> => {
  if (!selection) return {};
  const ids = selection.id ? [selection.id] : [];
  return { expertIds: ids };
};

export class BuiltinCodingDriver implements CodingAgentDriver {
  private readonly sessionConfigOptions = new Map<string, CodingAgentConfigOption[]>();
  /** Cache expert choices until the runtime announces a catalog change. */
  private commandChoices: BuiltinCodingCommandChoices | null = null;
  private commandChoicesGeneration = -1;

  constructor(private readonly runtime: BuiltinCodingRuntime) {}

  async getCapabilities(): Promise<CodingAgentCapabilities> {
    return BUILTIN_CAPABILITIES;
  }
  async getAuthState(): Promise<CodingAgentAuthState> {
    return { authenticated: true, canAuthenticate: false };
  }
  async authenticate(_request: CodingAgentAuthRequest): Promise<void> {
    throw new Error(CodingErrorMessage.BuiltinAuthNotRequired);
  }
  async createSession(input: {
    workspaceRoot: string;
    localSessionId?: string;
    existingConfigOptions?: CodingAgentConfigOption[];
  }): Promise<CodingAgentSession> {
    const id = input.localSessionId ?? randomUUID();
    const configOptions = this.buildOptions(input.existingConfigOptions);
    this.sessionConfigOptions.set(id, configOptions);
    this.refreshCommandChoices();
    return {
      id,
      remoteSessionId: null,
      configOptions,
      availableCommands: buildBuiltinCodingCommandList(this.commandChoices),
    };
  }
  async loadSession(_input: { remoteSessionId: string }): Promise<CodingAgentSession> {
    throw new Error('The built-in coding agent does not load remote sessions.');
  }
  /** Options a new session would start with, without binding them to a session. */
  getDefaultConfigOptions(): CodingAgentConfigOption[] {
    return this.buildOptions();
  }
  /** Commands a new session would start with, without binding them to a session. */
  getDefaultAvailableCommands(): CodingAgentAvailableCommand[] {
    return buildBuiltinCodingCommandList(this.cachedCommandChoices());
  }
  async *prompt(input: {
    sessionId: string;
    workspaceRoot: string;
    prompt: string;
    modelOverride?: string | null;
  }): AsyncIterable<Omit<CodingEvent, 'id' | 'laneId' | 'sequence' | 'createdAt'>> {
    const thinkingLevel = this.currentThinkingLevel(input.sessionId);
    const parsed = parseBuiltinCodingPrompt(input.prompt, this.cachedCommandChoices());
    await this.runtime.start(input.sessionId, input.workspaceRoot, parsed.prompt, {
      ...(input.modelOverride ? { modelOverride: input.modelOverride } : {}),
      ...(thinkingLevel ? { thinkingLevel } : {}),
      ...selectionOptions(parsed.selection),
      permissionMode: this.currentPermissionMode(input.sessionId),
    });
    // The in-process runtime emits streaming events after start() returns. The
    // CodingRoomService subscribes to that runtime directly, which avoids
    // snapshotting a race-prone event buffer and writing every event twice.
    yield* [];
  }
  async cancel(sessionId: string): Promise<void> {
    await this.runtime.cancel(sessionId);
  }
  async respondToPermission(_response: CodingPermissionResponse): Promise<void> {
    throw new Error(CodingErrorMessage.BuiltinPermissionsRuntime);
  }
  async setConfigOption(
    sessionId: string,
    configId: string,
    value: string | boolean,
  ): Promise<CodingAgentConfigOption[]> {
    const options = this.sessionConfigOptions.get(sessionId) ?? this.buildOptions();
    this.sessionConfigOptions.set(sessionId, options);
    const option = options.find(candidate => candidate.id === configId);
    if (!option) throw new Error(CodingErrorMessage.BuiltinConfigOptionNotFound);
    if (
      typeof value !== 'string' ||
      !option.options?.some(candidate => candidate.value === value)
    ) {
      throw new Error(CodingErrorMessage.BuiltinConfigValueInvalid);
    }
    option.currentValue = value;
    if (configId === BuiltinCodingConfigId.ThinkingLevel) {
      await this.runtime.patchSession?.(sessionId, { thinkingLevel: value });
    }
    if (configId === BuiltinCodingConfigId.PermissionMode) {
      // The select-option whitelist above already validated the value.
      this.runtime.setApprovalMode?.(sessionId, value as ToolApprovalMode);
    }
    return options;
  }
  getSessionConfigOptions(sessionId: string): CodingAgentConfigOption[] {
    return this.sessionConfigOptions.get(sessionId) ?? [];
  }
  getSessionAvailableCommands(_sessionId: string): CodingAgentAvailableCommand[] {
    return buildBuiltinCodingCommandList(this.cachedCommandChoices());
  }
  private readCommandChoices(): BuiltinCodingCommandChoices {
    return this.runtime.listCommandChoices?.() ?? EMPTY_BUILTIN_CODING_COMMAND_CHOICES;
  }
  private currentCatalogGeneration(): number {
    return this.runtime.commandCatalogGeneration?.() ?? 0;
  }
  private refreshCommandChoices(): BuiltinCodingCommandChoices {
    this.commandChoices = this.readCommandChoices();
    this.commandChoicesGeneration = this.currentCatalogGeneration();
    return this.commandChoices;
  }
  private cachedCommandChoices(): BuiltinCodingCommandChoices {
    if (
      this.commandChoices === null ||
      this.commandChoicesGeneration !== this.currentCatalogGeneration()
    ) {
      return this.refreshCommandChoices();
    }
    return this.commandChoices;
  }
  onAvailableCommandsChanged(
    _listener: (sessionId: string, commands: CodingAgentAvailableCommand[]) => void,
  ): () => void {
    return () => undefined;
  }
  onSessionTitleChanged(_listener: (sessionId: string, title: string) => void): () => void {
    return () => undefined;
  }
  async disposeSession(sessionId: string): Promise<void> {
    this.sessionConfigOptions.delete(sessionId);
  }
  async dispose(): Promise<void> {
    this.sessionConfigOptions.clear();
  }

  private buildOptions(existing?: CodingAgentConfigOption[]): CodingAgentConfigOption[] {
    const persistedThinking = existing?.find(
      candidate => candidate.id === BuiltinCodingConfigId.ThinkingLevel,
    )?.currentValue;
    const persistedPermissionMode = existing?.find(
      candidate => candidate.id === BuiltinCodingConfigId.PermissionMode,
    )?.currentValue;
    return [
      {
        id: BuiltinCodingConfigId.ThinkingLevel,
        name: t('codingAgentConfigThinkingLevel'),
        type: 'select',
        currentValue:
          typeof persistedThinking === 'string' && isValidThinkingLevel(persistedThinking)
            ? persistedThinking
            : PiThinkingLevel.Medium,
        options: THINKING_LEVEL_OPTIONS,
      },
      {
        id: BuiltinCodingConfigId.PermissionMode,
        name: t('codingAgentConfigPermissionMode'),
        type: 'select',
        currentValue:
          typeof persistedPermissionMode === 'string' &&
          isValidApprovalMode(persistedPermissionMode)
            ? persistedPermissionMode
            : ToolApprovalMode.Ask,
        options: [
          { value: ToolApprovalMode.Ask, name: t('codingAgentPermissionModeAsk') },
          { value: ToolApprovalMode.Auto, name: t('codingAgentPermissionModeAuto') },
          { value: ToolApprovalMode.AllowAll, name: t('codingAgentPermissionModeAllowAll') },
        ],
      },
    ];
  }

  private currentThinkingLevel(sessionId: string): string | undefined {
    const option = this.sessionConfigOptions
      .get(sessionId)
      ?.find(candidate => candidate.id === BuiltinCodingConfigId.ThinkingLevel);
    return typeof option?.currentValue === 'string' && option.currentValue
      ? option.currentValue
      : undefined;
  }

  private currentPermissionMode(sessionId: string): ToolApprovalMode {
    const option = this.sessionConfigOptions
      .get(sessionId)
      ?.find(candidate => candidate.id === BuiltinCodingConfigId.PermissionMode);
    return typeof option?.currentValue === 'string' && isValidApprovalMode(option.currentValue)
      ? option.currentValue
      : ToolApprovalMode.Ask;
  }
}
