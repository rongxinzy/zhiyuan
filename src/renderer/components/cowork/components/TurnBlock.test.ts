// @vitest-environment jsdom
import { createElement } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { CoworkErrorKind } from '../../../../common/coworkError';

import {
  CoworkMessageType,
  CoworkDisplayItemType,
  CoworkPermissionBehavior,
  CoworkPermissionOrigin,
} from '../../../../shared/cowork/constants';
import { CoworkInterruptionCause } from '../../../../shared/cowork/interruption';
import { CoworkToolActivityPhase } from '../../../../shared/cowork/toolActivity';
import { CoworkArtifactRole, CoworkArtifactSource } from '../../../../shared/cowork/artifacts';
import { i18nService } from '../../../services/i18n';
import type {
  CoworkMessage,
  CoworkMessageMetadata,
  CoworkPermissionRequest,
} from '../../../types/cowork';
import type { AssistantTurnItem, ConversationTurn } from '../helpers/messageGrouping';
import { TurnBlock, getTurnPrimaryExpert, isTerminalErrorItem } from './TurnBlock';
import { setPersistentToggleNamespace } from '../hooks/usePersistentToggle';

vi.mock('@shared/components/ai-elements/code-block', () => ({
  CodeBlock: ({ code }: { code: string }) => createElement('pre', null, code),
}));
vi.mock('../../artifacts/ArtifactPreviewCard', () => ({
  default: ({ artifact }: { artifact: { title: string } }) =>
    createElement('span', null, artifact.title),
}));
i18nService.setLanguage('zh', { persist: false });
let counter = 0;
const message = (
  type: CoworkMessage['type'],
  content: string,
  metadata: CoworkMessageMetadata = {},
): CoworkMessage => ({ id: `message-${++counter}`, type, content, timestamp: counter, metadata });
const tool = (complete = true): AssistantTurnItem => {
  const toolUse = message(CoworkMessageType.ToolUse, '', {
    toolName: 'bash',
    toolInput: { command: 'pwd' },
  });
  return {
    type: CoworkDisplayItemType.ToolGroup,
    group: {
      type: CoworkDisplayItemType.ToolGroup,
      toolUse,
      toolResult: complete ? message(CoworkMessageType.ToolResult, 'ok') : undefined,
    },
  };
};
const answer = (content: string): AssistantTurnItem => ({
  type: CoworkMessageType.Assistant,
  message: message(CoworkMessageType.Assistant, content),
});
const renderTurn = (
  items: AssistantTurnItem[],
  props: Partial<Parameters<typeof TurnBlock>[0]> = {},
) => {
  setPersistentToggleNamespace(`test-${++counter}`);
  return render(
    createElement(TurnBlock, {
      turn: { id: `turn-${counter}`, userMessage: null, assistantItems: items },
      showCopyButtons: false,
      hideDefaultAssistantHeader: true,
      ...props,
    }),
  );
};

test('groups completed tool entries under a collapsed execution toggle', () => {
  renderTurn([tool(), tool()]);
  const details = screen.getByRole('button', { name: i18nService.t('coworkExecutionDetails') });
  expect(details).toHaveAttribute('aria-expanded', 'false');
  expect(screen.getAllByRole('button')).toHaveLength(1);
  fireEvent.click(details);
  const toggles = screen.getAllByRole('button');
  expect(toggles).toHaveLength(3);
  expect(toggles.slice(1).every(button => button.getAttribute('aria-expanded') === 'false')).toBe(
    true,
  );
  fireEvent.click(toggles[1]);
  expect(screen.getByText('ok')).toBeVisible();
  expect(toggles[2]).toHaveAttribute('aria-expanded', 'false');
});

test('puts the final answer before details while keeping terminal errors visible', () => {
  renderTurn([
    answer('先检查目录'),
    tool(),
    answer('检查完成'),
    {
      type: CoworkMessageType.System,
      message: message(CoworkMessageType.System, '连接失败', { error: 'connection failed' }),
    },
  ]);
  expect(screen.queryByText('先检查目录')).toBeNull();
  expect(screen.getByText('检查完成')).toBeVisible();
  expect(screen.getByText('连接失败')).toBeVisible();
  const details = screen.getByRole('button', { name: i18nService.t('coworkExecutionDetails') });
  expect(
    screen.getByText('检查完成').compareDocumentPosition(details) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  fireEvent.click(details);
  expect(screen.getByText('先检查目录')).toBeVisible();
});

test('keeps live progress in stream order until completion', () => {
  const first = answer('Checking files');
  const last = answer('Result ready');
  const items = [first, tool(), last];
  const { rerender } = renderTurn(items, { isTurnComplete: false });
  expect(screen.getByText('Checking files')).toBeVisible();
  expect(screen.queryByText(i18nService.t('coworkExecutionDetails'))).toBeNull();
  rerender(
    createElement(TurnBlock, {
      turn: { id: 'completed', userMessage: null, assistantItems: items },
      isTurnComplete: true,
      showCopyButtons: false,
    }),
  );
  expect(screen.queryByText('Checking files')).toBeNull();
  expect(screen.getByText('Result ready')).toBeVisible();
});

test('keeps deliverables above execution details and exports the full process', () => {
  renderTurn([answer('Checking files'), tool(), answer('File ready')], {
    expandToolResults: true,
    artifacts: [
      {
        id: 'file',
        messageId: 'result',
        sessionId: 'session',
        type: 'text',
        title: 'Delivered report',
        content: 'report',
        source: CoworkArtifactSource.Tool,
        role: CoworkArtifactRole.Deliverable,
        declared: true,
        createdAt: 1,
      },
    ],
  });
  const details = screen.getByRole('button', { name: i18nService.t('coworkExecutionDetails') });
  expect(
    screen.getByText('Delivered report').compareDocumentPosition(details) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(screen.getByText('Checking files')).toBeVisible();
  expect(screen.getByText('ok')).toBeVisible();
});

test('preserves details expansion across virtualization remounts', () => {
  const items = [answer('Preparation'), tool(), answer('Done')];
  const { unmount } = renderTurn(items);
  fireEvent.click(screen.getByRole('button', { name: i18nService.t('coworkExecutionDetails') }));
  unmount();
  render(
    createElement(TurnBlock, {
      turn: { id: `turn-${counter}`, userMessage: null, assistantItems: items },
      showCopyButtons: false,
    }),
  );
  expect(screen.getByText('Preparation')).toBeVisible();
});

test('keeps unfinished and failed tools outside completed details', () => {
  const failure = tool();
  if (failure.type !== CoworkDisplayItemType.ToolGroup) throw new Error('Expected a tool fixture');
  failure.group.toolResult!.metadata = { isError: true };
  renderTurn([tool(), failure, tool(false), answer('Partial result')]);
  expect(screen.getByText(i18nService.t('codingAgentToolRunning'))).toBeVisible();
  expect(screen.getAllByRole('button')).toHaveLength(3);
  expect(screen.getByText('Partial result')).toBeVisible();
});

test('does not fold late streaming results or message-level errors in a settled turn', () => {
  const streamingTool = tool();
  if (streamingTool.type !== CoworkDisplayItemType.ToolGroup)
    throw new Error('Expected a tool fixture');
  streamingTool.group.toolResult!.metadata = { isStreaming: true };
  const error = answer('Could not finish the request');
  if (error.type !== CoworkMessageType.Assistant) throw new Error('Expected an answer fixture');
  error.message.metadata = { isError: true };
  renderTurn([tool(), streamingTool, error, answer('Partial summary')]);
  expect(screen.getByText('Could not finish the request')).toBeVisible();
  expect(screen.getAllByRole('button')).toHaveLength(2);
});

test('shows matching permission immediately and forwards the original input', () => {
  const item = tool(false);
  if (item.type !== CoworkDisplayItemType.ToolGroup) throw new Error('Expected a tool fixture');
  const permission: CoworkPermissionRequest = {
    origin: CoworkPermissionOrigin.PiWorkbench,
    sessionId: 'session',
    requestId: 'request',
    toolName: 'bash',
    toolInput: { command: 'pwd' },
    toolUseId: item.group.toolUse.id,
  };
  const onRespondToPermission = vi.fn();
  renderTurn([item], {
    isTurnComplete: false,
    pendingPermission: permission,
    onRespondToPermission,
  });
  fireEvent.click(screen.getByRole('button', { name: i18nService.t('coworkApprove') }));
  expect(onRespondToPermission).toHaveBeenCalledWith({
    behavior: CoworkPermissionBehavior.Allow,
    updatedInput: permission.toolInput,
  });
  fireEvent.click(screen.getByRole('button', { name: i18nService.t('coworkDeny') }));
  expect(onRespondToPermission).toHaveBeenCalledWith({
    behavior: CoworkPermissionBehavior.Deny,
    message: 'Permission denied',
  });
});

test('never hides an approval when a completed turn also has collapsed tools', () => {
  // A pending approval has no result yet, even if a terminal turn update arrived.
  // Completed tools intentionally leave approval rendering to the session fallback.
  const item = tool(false);
  if (item.type !== CoworkDisplayItemType.ToolGroup) throw new Error('Expected a tool fixture');
  const permission: CoworkPermissionRequest = {
    origin: CoworkPermissionOrigin.PiWorkbench,
    sessionId: 'session',
    requestId: 'pending',
    toolName: 'bash',
    toolInput: { command: 'pwd' },
    toolUseId: item.group.toolUse.id,
  };
  const onRespondToPermission = vi.fn();
  renderTurn([tool(), item, answer('Waiting')], {
    pendingPermission: permission,
    onRespondToPermission,
  });
  expect(
    screen.getByRole('button', { name: i18nService.t('coworkExecutionDetails') }),
  ).toHaveAttribute('aria-expanded', 'false');
  expect(screen.getByRole('button', { name: i18nService.t('coworkApprove') })).toBeVisible();
  expect(screen.getByText(i18nService.t('coworkPermissionDecisionHint'))).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: i18nService.t('coworkApprove') }));
  expect(onRespondToPermission).toHaveBeenCalledWith({
    behavior: CoworkPermissionBehavior.Allow,
    updatedInput: permission.toolInput,
  });
});

test('keeps message-level states free of competing decorative animations', () => {
  const { container } = renderTurn([tool(false)], { isTurnComplete: false });
  expect(
    container.querySelector('.bg-clip-text, .animate-pulse, .animate-message-in, img'),
  ).toBeNull();
  expect(screen.getByText(i18nService.t('codingAgentToolRunning'))).toBeVisible();
});

test('keeps a preparation status visible without an empty collapsible', () => {
  renderTurn([], {
    isTurnComplete: false,
    toolActivities: [
      {
        toolCallId: 'preparing',
        toolName: 'bash',
        phase: CoworkToolActivityPhase.Preparing,
        updatedAt: 1,
      },
    ],
  });
  expect(screen.getByRole('status')).toBeVisible();
  expect(screen.queryByRole('button')).toBeNull();
});

test('renders historical interruption without a legacy execution button', () => {
  const interruption = {
    sessionId: 'session',
    interruptionId: 'interruption',
    cause: CoworkInterruptionCause.RuntimePaused,
    taskId: 'task',
    recoverable: true,
  };
  const item: AssistantTurnItem = {
    type: CoworkMessageType.System,
    message: message(CoworkMessageType.System, '', { interruption }),
  };
  renderTurn([item]);
  expect(
    screen.queryByRole('button', { name: i18nService.t('coworkResumeTaskAction') }),
  ).toBeNull();
  expect(screen.getByText(i18nService.t('coworkInterruptionRuntimePaused'))).toBeVisible();
});

const expert = { expertId: 'expert-a', expertName: 'Draft Expert', presetId: 'draft' };

describe('getTurnPrimaryExpert', () => {
  test('prefers the frozen user-message expert identity', () => {
    const turn: ConversationTurn = {
      id: 'turn-1',
      userMessage: {
        id: 'user-1',
        type: CoworkMessageType.User,
        content: 'Write',
        timestamp: 1,
        metadata: { experts: [expert] },
      },
      assistantItems: [],
    };

    expect(getTurnPrimaryExpert(turn)).toEqual(expert);
  });

  test('falls back to the frozen assistant-message expert identity', () => {
    const turn: ConversationTurn = {
      id: 'turn-1',
      userMessage: null,
      assistantItems: [
        {
          type: CoworkMessageType.Assistant,
          message: {
            id: 'assistant-1',
            type: CoworkMessageType.Assistant,
            content: 'Done',
            timestamp: 2,
            metadata: { experts: [expert] },
          },
        },
      ],
    };

    expect(getTurnPrimaryExpert(turn)).toEqual(expert);
  });
});

describe('terminal error presentation', () => {
  test('identifies terminal system errors independently of their rendered content', () => {
    expect(
      isTerminalErrorItem({
        type: CoworkMessageType.System,
        message: {
          id: 'error-1',
          type: CoworkMessageType.System,
          content: '',
          timestamp: 1,
          metadata: { error: 'Model failed', errorKind: CoworkErrorKind.Unknown },
        },
      }),
    ).toBe(true);
  });

  test('keeps tool failures and approval interruptions out of terminal-error handling', () => {
    expect(
      isTerminalErrorItem({
        type: CoworkMessageType.ToolResult,
        message: {
          id: 'tool-1',
          type: CoworkMessageType.ToolResult,
          content: 'Command failed',
          timestamp: 1,
          metadata: { isError: true, error: 'Command failed' },
        },
      }),
    ).toBe(false);
    expect(
      isTerminalErrorItem({
        type: CoworkMessageType.System,
        message: {
          id: 'interruption-1',
          type: CoworkMessageType.System,
          content: '',
          timestamp: 2,
          metadata: {
            interruption: {
              cause: CoworkInterruptionCause.ApprovalDenied,
              sessionId: 'session-1',
              interruptionId: 'interruption-1',
              taskId: null,
              recoverable: false,
            },
          },
        },
      }),
    ).toBe(false);
  });
});
