import { refreshMagpieModels } from '../../services/availableModels';
import { cn } from '@shared/lib/utils';
import React, { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { buildSessionTitleFromInput } from '../../../common/sessionTitle';
import {
  CoworkExecutionMode,
  CoworkPermissionMode,
  CoworkSessionMode,
  CoworkSessionSource,
} from '../../../shared/cowork/constants';
import { CoworkSessionExpertSource } from '../../../shared/cowork/sessionExperts';
import { agentService } from '../../services/agent';
import { coworkService } from '../../services/cowork';
import { coworkQueueService } from '../../services/coworkQueue';
import { i18nService } from '../../services/i18n';
import { normalizeError } from '../../services/errorNormalization';
import { showAppErrorToast } from '../../services/toastNotification';
import { RafMessageUpdateBatcher } from '../../services/rafMessageUpdateBatcher';
import { workspaceService } from '../../services/workspace';
import { RootState } from '../../store';
import {
  selectCoworkConfig,
  selectCurrentSession,
  selectDisplayedSessionId,
  selectIsStreaming,
} from '../../store/selectors/coworkSelectors';
import { selectWorkMode } from '../../store/selectors/workModeSelectors';
import {
  addMessage,
  addSession,
  clearCurrentSession,
  updateMessageContents,
} from '../../store/slices/coworkSlice';
import { WorkMode } from '../../store/workMode/constants';
import {
  type CoworkImageAttachment,
  type CoworkFileAttachment,
  type CoworkPermissionRequest,
  type CoworkPermissionResult,
  type CoworkSession,
} from '../../types/cowork';
import { toAgentModelRef } from '../../utils/agentModelRef';
import { isScratchWorkspacePath } from '../../utils/path';
import type { SettingsOpenOptions } from '../settings/types';
import PageHeader from '../PageHeader';
import { LogoLoadingState } from '../LogoLoadingState';
import { useAgentSelectedModel } from './agentModelSelection';
import CoworkPromptInput, { type CoworkPromptInputRef } from './CoworkPromptInput';
import CoworkSessionViewport from './CoworkSessionViewport';
import SecurityStatusIndicator from './SecurityStatusIndicator';
import { useUnmanagedWorkingDirectory } from './useUnmanagedWorkingDirectory';
import { WorkBriefingHome } from './briefing/WorkBriefingHome';

export interface CoworkViewProps {
  onRequestAppSettings?: (options?: SettingsOpenOptions) => void;
  onShowScheduledTasks?: () => void;
  isSidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  onNewChat?: () => void;
  updateBadge?: React.ReactNode;
  inlineQuestionPermission?: CoworkPermissionRequest | null;
  onRespondToInlineQuestion?: (result: CoworkPermissionResult) => void | Promise<void>;
  inlinePermission?: CoworkPermissionRequest | null;
  onRespondToInlinePermission?: (result: CoworkPermissionResult) => void | Promise<void>;
}

const CoworkView: React.FC<CoworkViewProps> = ({
  onRequestAppSettings,
  onShowScheduledTasks,
  isSidebarCollapsed,
  onToggleSidebar,
  onNewChat,
  updateBadge,
  inlineQuestionPermission,
  onRespondToInlineQuestion,
  inlinePermission,
  onRespondToInlinePermission,
}) => {
  const dispatch = useDispatch();

  const contentBatcherRef = useRef<RafMessageUpdateBatcher | null>(null);
  if (!contentBatcherRef.current) {
    contentBatcherRef.current = new RafMessageUpdateBatcher(updates => {
      dispatch(updateMessageContents(updates));
    });
  }
  const contentBatcher = contentBatcherRef.current;

  useEffect(() => () => contentBatcher.dispose(), [contentBatcher]);
  const [isInitialized, setIsInitialized] = useState(false);
  const startingSessionIdsRef = useRef(new Set<string>());
  const continuingSessionIdsRef = useRef(new Set<string>());
  // Track pending start request so stop can cancel delayed startup.
  const pendingStartRef = useRef<{
    requestId: number;
    cancelled: boolean;
    cancellationAction: 'stop' | 'delete' | null;
  } | null>(null);
  const startRequestIdRef = useRef(0);
  // Ref for CoworkPromptInput
  const promptInputRef = useRef<CoworkPromptInputRef>(null);

  const currentSession = useSelector(selectCurrentSession);
  const displayedSessionId = useSelector(selectDisplayedSessionId);
  const workMode = useSelector(selectWorkMode);
  // Clear session when workMode changes and current session mode doesn't match.
  // Sessions without an explicit mode field (legacy) are treated as work mode.
  const prevWorkModeRef = useRef(workMode);
  useEffect(() => {
    if (prevWorkModeRef.current !== workMode) {
      prevWorkModeRef.current = workMode;
      const sessionMode = currentSession?.mode || WorkMode.Work;
      if (sessionMode !== workMode) {
        dispatch(clearCurrentSession());
      }
    }
  }, [workMode, currentSession?.mode, dispatch]);

  const isStreaming = useSelector(selectIsStreaming);
  const config = useSelector(selectCoworkConfig);
  const sessionPermissionMode = currentSession
    ? (config.permissionModeBySession?.[currentSession.id] ?? config.permissionMode)
    : config.permissionMode;

  const currentAgentId = useSelector((state: RootState) => state.agent.currentAgentId);
  const agents = useSelector((state: RootState) => state.agent.agents);
  const currentAgent = agents.find(agent => agent.id === currentAgentId);
  const workspaces = useSelector((state: RootState) => state.workspace.workspaces);
  const currentWorkspaceId = useSelector((state: RootState) => state.workspace.currentWorkspaceId);
  const currentWorkspace = workspaces.find(workspace => workspace.id === currentWorkspaceId);
  const defaultConversationWorkspace = workspaces.find(
    workspace => !workspace.isHidden && isScratchWorkspacePath(workspace.path),
  );
  const {
    clearUnmanagedWorkingDirectory,
    selectUnmanagedWorkingDirectory,
    unmanagedWorkingDirectory,
  } = useUnmanagedWorkingDirectory({ currentWorkspaceId });
  const currentSessionWorkingDirectory =
    currentSession?.workspaceId === currentWorkspaceId ? currentSession.cwd : '';
  const activeWorkspacePath =
    currentSessionWorkingDirectory || unmanagedWorkingDirectory || currentWorkspace?.path || '';
  const currentWorkspacePath =
    activeWorkspacePath ||
    (workMode === WorkMode.Work ? defaultConversationWorkspace?.path : config.workingDirectory) ||
    '';
  const currentWorkspaceDisplayName =
    currentWorkspace && !currentWorkspace.isHidden && isScratchWorkspacePath(currentWorkspace.path)
      ? i18nService.t('defaultConversation')
      : currentWorkspace && !currentWorkspace.isHidden
        ? currentWorkspace.name
        : currentWorkspacePath === defaultConversationWorkspace?.path
          ? i18nService.t('defaultConversation')
          : undefined;

  const currentAgentSelectedModel = useAgentSelectedModel(
    currentAgentId,
    currentAgent?.model ?? '',
  );

  useEffect(() => {
    const init = async () => {
      await coworkService.init();
      await agentService.loadAgents();
      try {
        const catalog = await refreshMagpieModels();
        if (catalog.status.state !== 'running' || catalog.models.length === 0) {
          onRequestAppSettings?.({
            initialTab: 'model',
            noticeI18nKey: 'magpieCatalogEmpty',
          });
        }
      } catch (error) {
        console.error('Failed to check cowork API config:', error);
      }
      setIsInitialized(true);
    };
    init();

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch]);

  useEffect(() => {
    if (!isInitialized || !currentWorkspaceId) return;
    void coworkService.loadSessions(undefined, currentWorkspaceId);
  }, [currentWorkspaceId, isInitialized]);

  const handleStartSession = async (
    prompt: string,
    imageAttachments?: CoworkImageAttachment[],
    fileAttachments?: CoworkFileAttachment[],
    expertIds: string[] = [],
  ): Promise<boolean | void> => {
    console.log('[CoworkView] handleStartSession: imageAttachments diagnosis', {
      hasImageAttachments: !!imageAttachments,
      count: imageAttachments?.length ?? 0,
      details:
        imageAttachments?.map(a => ({
          name: a.name,
          mimeType: a.mimeType,
          base64Length: a.base64Data?.length ?? 0,
        })) ?? [],
    });
    // Prevent duplicate submissions for the same session context.
    // Use currentSession.id so a second chat/work window can submit in parallel.
    const startSessionKey = currentSession?.id ?? `new-${workMode}`;
    if (startingSessionIdsRef.current.has(startSessionKey)) return;
    startingSessionIdsRef.current.add(startSessionKey);
    const requestId = ++startRequestIdRef.current;
    pendingStartRef.current = { requestId, cancelled: false, cancellationAction: null };
    const isPendingStartCancelled = () => {
      const pending = pendingStartRef.current;
      return !pending || pending.requestId !== requestId || pending.cancelled;
    };
    const getPendingCancellationAction = () => {
      const pending = pendingStartRef.current;
      if (!pending || pending.requestId !== requestId || !pending.cancelled) {
        return null;
      }
      return pending.cancellationAction;
    };

    try {
      try {
        const catalog = await refreshMagpieModels();
        if (catalog.status.state !== 'running' || catalog.models.length === 0) {
          onRequestAppSettings?.({
            initialTab: 'model',
            noticeI18nKey: 'magpieCatalogEmpty',
          });
          startingSessionIdsRef.current.delete(startSessionKey);
          return false;
        }
      } catch (error) {
        console.error('Failed to check cowork API config:', error);
      }

      // Create a temporary session with user message to show immediately
      const tempSessionId = `temp-${Date.now()}`;
      const fallbackTitle = buildSessionTitleFromInput(
        prompt,
        i18nService.t('coworkDefaultSessionTitle'),
      );
      const now = Date.now();

      // Chat sessions stay tagged as chat sessions while every turn executes
      // through the Pi agent runtime.
      const isChatAgentExecution = workMode === WorkMode.Chat;

      const tempSession: CoworkSession = {
        id: tempSessionId,
        title: fallbackTitle,
        status: 'idle',
        mode: workMode,
        pinned: false,
        createdAt: now,
        updatedAt: now,
        cwd: currentWorkspacePath,
        systemPrompt: '',
        modelOverride: currentAgentSelectedModel ? toAgentModelRef(currentAgentSelectedModel) : '',
        executionMode: config.executionMode || CoworkExecutionMode.Local,
        workspaceId: currentWorkspaceId || '',
        agentId: currentAgentId,
        source: CoworkSessionSource.Manual,
        messages: [
          {
            id: `msg-${now}`,
            type: 'user',
            content: prompt,
            timestamp: now,
            metadata:
              (imageAttachments && imageAttachments.length > 0) ||
              (fileAttachments && fileAttachments.length > 0)
                ? {
                    ...(imageAttachments && imageAttachments.length > 0
                      ? { imageAttachments }
                      : {}),
                    ...(fileAttachments && fileAttachments.length > 0 ? { fileAttachments } : {}),
                  }
                : undefined,
          },
        ],
        messagesOffset: 0,
        totalMessages: 1,
      };

      // Keep the temporary session in the list while the backend creates its
      // persistent Pi session, so attachments and the initial prompt remain
      // visible if startup takes time or fails.
      dispatch(addSession(tempSession));
      const isExpertAgent =
        currentAgent?.source === CoworkSessionExpertSource.Package ||
        currentAgent?.source === CoworkSessionExpertSource.Member;
      const agentSystemPrompt = isExpertAgent ? undefined : currentAgent?.systemPrompt?.trim();
      const baseSystemPrompt = isChatAgentExecution
        ? ''
        : agentSystemPrompt || config.systemPrompt || '';
      const sessionSystemPrompt = baseSystemPrompt;

      // Chat hides the folder selector, so the engine relies on
      // the configured default working directory. Bail out early with a toast
      // when no working directory is available at all.
      if (isChatAgentExecution && !currentWorkspacePath) {
        window.dispatchEvent(
          new CustomEvent('app:showToast', {
            detail: i18nService.t('chatAgentWorkingDirectoryRequired'),
          }),
        );
        dispatch(clearCurrentSession());
        return;
      }

      // Start the actual session immediately with fallback title
      const sessionModelOverride = currentAgentSelectedModel
        ? toAgentModelRef(currentAgentSelectedModel)
        : '';
      console.log('[CoworkView] creating session:', {
        modelId: currentAgentSelectedModel?.id,
        providerKey: currentAgentSelectedModel?.providerKey,
        agentId: currentAgentId,
        agentName: currentAgent?.name,
        agentSource: currentAgent?.source,
        agentSystemPrompt: agentSystemPrompt ? `${agentSystemPrompt.slice(0, 80)}...` : '(empty)',
        sessionSystemPrompt: sessionSystemPrompt
          ? `${sessionSystemPrompt.slice(0, 120)}...`
          : '(undefined)',
      });
      const { session: startedSession, error: startError } = await coworkService.startSession(
        {
          prompt,
          title: fallbackTitle,
          cwd: currentWorkspacePath || undefined,
          // An empty base prompt must stay undefined so main can fall back to the
          // agent's/default system prompt instead of composing from ''.
          systemPrompt: sessionSystemPrompt || undefined,
          // Chat stays tagged as a chat session so it remains in the Chat
          // sidebar list; Work sessions keep the default work mode.
          mode: isChatAgentExecution ? CoworkSessionMode.Chat : CoworkSessionMode.Work,
          workspaceId: currentWorkspaceId || undefined,
          agentId: currentAgentId,
          expertIds,
          modelOverride: sessionModelOverride,
          permissionMode: config.permissionMode,
          imageAttachments,
          fileAttachments,
        },
        tempSessionId,
      );

      if (!startedSession && startError) {
        // Show the error as a system message in the temp session
        dispatch(
          addMessage({
            sessionId: tempSessionId,
            message: {
              id: `error-${Date.now()}`,
              type: 'system',
              content: i18nService
                .t('coworkErrorSessionStartFailed')
                .replace('{error}', startError),
              timestamp: Date.now(),
            },
          }),
        );
        return;
      }

      if (startedSession) {
        clearUnmanagedWorkingDirectory();
      }

      // Stop immediately if user cancelled while startup request was in flight.
      if (isPendingStartCancelled() && startedSession) {
        await coworkService.stopSession(startedSession.id);
        if (getPendingCancellationAction() === 'delete') {
          await coworkService.deleteSession(startedSession.id);
        }
      }
    } finally {
      if (pendingStartRef.current?.requestId === requestId) {
        pendingStartRef.current = null;
      }
      startingSessionIdsRef.current.delete(startSessionKey);
    }
  };

  const handleContinueSession = async (
    prompt: string,
    imageAttachments?: CoworkImageAttachment[],
    fileAttachments?: CoworkFileAttachment[],
    expertIds: string[] = [],
  ) => {
    if (!currentSession) return;
    if (continuingSessionIdsRef.current.has(currentSession.id)) return;

    // Work keeps the prompt editable while Pi is running. Normal input during
    // a live Work turn becomes an ordered Follow-up item; Chat uses Pi's
    // regular continuation path.
    if (
      workMode === WorkMode.Work &&
      isStreaming &&
      (currentSession.mode ?? CoworkSessionMode.Work) === CoworkSessionMode.Work
    ) {
      const result = await coworkQueueService.enqueue(
        currentSession.id,
        prompt,
        imageAttachments,
        fileAttachments,
      );
      if (!result.success) {
        window.dispatchEvent(
          new CustomEvent('app:showToast', {
            detail: {
              message: normalizeError(result.error || i18nService.t('coworkQueueEnqueueFailed')),
              isError: true,
            },
          }),
        );
        return false;
      }
      return true;
    }

    // Pi continuation path for Work and Chat sessions.
    continuingSessionIdsRef.current.add(currentSession.id);
    try {
      const isExpertAgent =
        currentAgent?.source === CoworkSessionExpertSource.Package ||
        currentAgent?.source === CoworkSessionExpertSource.Member;
      const agentSystemPrompt = isExpertAgent ? undefined : currentAgent?.systemPrompt?.trim();
      const isChatMode = workMode === WorkMode.Chat;
      const baseSystemPrompt = isChatMode ? '' : agentSystemPrompt || config.systemPrompt || '';

      await coworkService.continueSession({
        sessionId: currentSession.id,
        prompt,
        systemPrompt: isChatMode
          ? baseSystemPrompt || undefined
          : currentSession.systemPrompt || baseSystemPrompt,
        expertIds,
        permissionMode: sessionPermissionMode,
        imageAttachments,
        fileAttachments,
      });
    } finally {
      continuingSessionIdsRef.current.delete(currentSession.id);
    }
  };

  const handleStopSession = async () => {
    if (!currentSession) return;
    if (currentSession.id.startsWith('temp-') && pendingStartRef.current) {
      pendingStartRef.current.cancelled = true;
      pendingStartRef.current.cancellationAction = 'stop';
    }
    await coworkService.stopSession(currentSession.id);
  };

  useEffect(() => {
    const handleNewSession = () => {
      // Only clear when already on home (no session) — preserve __home__ draft when returning from a session
      const shouldClear = !currentSession;
      dispatch(clearCurrentSession());
      window.dispatchEvent(
        new CustomEvent('cowork:focus-input', {
          detail: { clear: shouldClear },
        }),
      );
    };
    window.addEventListener('cowork:shortcut:new-session', handleNewSession);
    return () => {
      window.removeEventListener('cowork:shortcut:new-session', handleNewSession);
    };
  }, [dispatch, currentSession]);

  useEffect(() => {
    if (!currentSession || !isStreaming) return;

    const runningSessionId = currentSession.id;
    let lastFocusTime = 0;
    const FOCUS_DEBOUNCE_MS = 2000;

    const handleWindowFocus = () => {
      const now = Date.now();
      if (now - lastFocusTime < FOCUS_DEBOUNCE_MS) return;
      lastFocusTime = now;
      void coworkService.loadSession(runningSessionId);
    };

    window.addEventListener('focus', handleWindowFocus);
    return () => {
      window.removeEventListener('focus', handleWindowFocus);
    };
  }, [currentSession, isStreaming]);

  if (!isInitialized) {
    return (
      <div data-page-canvas className="flex-1 h-full flex flex-col bg-background">
        <PageHeader />
        <div className="flex-1 flex items-center justify-center">
          <LogoLoadingState label={i18nService.t('coworkWorkspaceLoading')} />
        </div>
      </div>
    );
  }

  const homeHeader = (
    <PageHeader
      title={workMode === WorkMode.Work ? i18nService.t('briefingTitle') : undefined}
      isSidebarCollapsed={isSidebarCollapsed}
      onToggleSidebar={onToggleSidebar}
      onNewChat={onNewChat}
      updateBadge={updateBadge}
      actions={<SecurityStatusIndicator />}
    />
  );

  if (displayedSessionId) {
    return (
      <div className="flex-1 flex flex-col h-full">
        <CoworkSessionViewport
          sessionId={displayedSessionId}
          permissionMode={sessionPermissionMode}
          onPermissionModeChange={(mode: CoworkPermissionMode) => {
            if (!currentSession) return;
            void coworkService.updateConfig({
              permissionModeBySession: {
                ...(config.permissionModeBySession ?? {}),
                [currentSession.id]: mode,
              },
            });
          }}
          onContinue={handleContinueSession}
          onStop={handleStopSession}
          isSidebarCollapsed={isSidebarCollapsed}
          onToggleSidebar={onToggleSidebar}
          onNewChat={onNewChat}
          updateBadge={updateBadge}
          workMode={workMode}
          inlineQuestionPermission={inlineQuestionPermission}
          onRespondToInlineQuestion={onRespondToInlineQuestion}
          inlinePermission={inlinePermission}
          onRespondToInlinePermission={onRespondToInlinePermission}
        />
      </div>
    );
  }

  const homePrompt = (
    <CoworkPromptInput
      ref={promptInputRef}
      onSubmit={handleStartSession}
      onStop={handleStopSession}
      isStreaming={isStreaming}
      disabled={false}
      placeholder={
        workMode === WorkMode.Chat
          ? i18nService.t('chatPlaceholder')
          : i18nService.t('coworkPlaceholder')
      }
      size={workMode === WorkMode.Chat ? 'large' : 'normal'}
      workingDirectory={currentWorkspacePath}
      workingDirectoryName={currentWorkspaceDisplayName}
      onWorkingDirectoryChange={async (dir: string) => {
        clearUnmanagedWorkingDirectory();
        const workspace = await workspaceService.ensureWorkspace(dir);
        if (workspace) await workspaceService.selectWorkspace(workspace.id);
      }}
      onCreateProject={async (dir, name) => {
        clearUnmanagedWorkingDirectory();
        const workspace = await workspaceService.createWorkspace(dir, name);
        if (!workspace) return false;
        await workspaceService.selectWorkspace(workspace.id);
        return true;
      }}
      onUseNoFolder={async dir => {
        const selected = await selectUnmanagedWorkingDirectory(dir);
        if (!selected) showAppErrorToast(i18nService.t('projectCreateFailed'));
      }}
      showFolderSelector={workMode !== WorkMode.Chat && !currentWorkspace?.isHidden}
      showNoFolderAction={!currentWorkspaceId}
      showModelSelector
      showPermissionModeSelector={workMode !== WorkMode.Chat}
      permissionMode={config.permissionMode}
      onPermissionModeChange={(mode: CoworkPermissionMode) => {
        void coworkService.updateConfig({ permissionMode: mode });
      }}
    />
  );
  if (workMode === WorkMode.Work) {
    return (
      <WorkBriefingHome
        header={homeHeader}
        prompt={homePrompt}
        onFocusInput={() => promptInputRef.current?.focus()}
        onShowScheduledTasks={onShowScheduledTasks}
      />
    );
  }

  // Chat home retains the shared plain-text composer.
  return (
    <div data-page-canvas className="flex-1 flex flex-col bg-background h-full">
      {/* Header */}
      {homeHeader}

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto min-h-0 relative">
        {/* Anchor to the viewport so opening a long case gallery never moves the input. */}
        <div aria-hidden className="min-h-[max(1.5rem,calc(45%-10rem))]" />

        <div className="mx-auto flex w-full max-w-4xl min-w-0 flex-col items-center gap-6 px-6">
          {/* Welcome Section and the prompt input share one sticky layer: once the
              cases start scrolling, the brand mark and the input both stay on screen
              instead of sliding away with the list. The layer is opaque and full
              width so the cases pass behind it rather than through it. It sits in the
              same column as the list, which is the box the sticky range is measured
              against, so it holds all the way to the last case. */}
          <div className="sticky theme-home-sticky top-0 z-10 flex w-full flex-col items-center gap-8 py-2">
            <div className="flex flex-col items-center justify-center gap-4 text-center">
              <img
                src="zhiyuan-logo-light.svg"
                alt={i18nService.t('cowork')}
                className="theme-home-brand logo-light w-auto mx-auto"
              />
              <img
                src="zhiyuan-logo-dark.svg"
                alt={i18nService.t('cowork')}
                className="theme-home-brand logo-dark w-auto mx-auto"
              />
              <p
                className={cn(
                  'theme-home-caption min-h-5 max-w-md px-2',
                  workMode === WorkMode.Chat && 'invisible',
                )}
              >
                {i18nService.t('coworkHomeSubtitle')}
              </p>
            </div>

            {/* Prompt Input Area - Large version with folder selector */}
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
              <div className="min-w-0">{homePrompt}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CoworkView;
