import { CoworkSessionMode, CoworkSessionSource, CoworkSessionStatus } from '../../../shared/cowork/constants';
import type { ScheduledTask } from '../../../scheduledTask/types';
import type { CoworkSessionSummary } from '../../types/cowork';
import {
  buildWorkBriefing,
  type BriefingInput,
  type BriefingItem,
} from '../cowork/briefing/projection';
import { BriefingTarget } from '../cowork/briefing/constants';
import { TaskBoardColumnId, type TaskBoardColumnId as ColumnId } from './constants';

export interface TaskBoardCard {
  id: string;
  title: string;
  detailKey: string;
  detailParams?: Record<string, string>;
  activityErrorMessage?: string;
  projectLabel?: string;
  showNeedsAttentionPill?: boolean;
  timestamp?: number;
  target: BriefingItem['target'];
  sessionId?: string;
  taskId?: string;
}

export type TaskBoardColumns = Record<ColumnId, TaskBoardCard[]>;

export interface TaskBoardProjectionInput extends BriefingInput {
  workspaces: readonly { id: string; name: string }[];
}

function workspaceName(
  workspaceId: string | undefined,
  workspaces: readonly { id: string; name: string }[],
): string | undefined {
  if (!workspaceId) return undefined;
  return workspaces.find(workspace => workspace.id === workspaceId)?.name;
}

function resolveProjectLabel(
  item: BriefingItem,
  sessions: readonly CoworkSessionSummary[],
  schedules: readonly ScheduledTask[],
  workspaces: readonly { id: string; name: string }[],
): string | undefined {
  if (item.taskId) {
    const task = schedules.find(entry => entry.id === item.taskId);
    return workspaceName(task?.workspaceId ?? undefined, workspaces);
  }
  const sessionId = item.sessionId;
  if (!sessionId) return undefined;
  const session = sessions.find(entry => entry.id === sessionId);
  return workspaceName(session?.workspaceId ?? undefined, workspaces);
}

function cardFromBriefing(
  item: BriefingItem,
  context: {
    sessions: readonly CoworkSessionSummary[];
    schedules: readonly ScheduledTask[];
    workspaces: readonly { id: string; name: string }[];
    needsAttention?: boolean;
  },
): TaskBoardCard {
  return {
    id: item.id,
    title: item.title || item.reasonKey,
    detailKey: item.headlineI18nKey ?? item.reasonKey,
    detailParams: item.headlineI18nParams,
    activityErrorMessage: item.activityErrorMessage,
    projectLabel: resolveProjectLabel(item, context.sessions, context.schedules, context.workspaces),
    showNeedsAttentionPill: context.needsAttention,
    timestamp: item.timestamp,
    target: item.target,
    sessionId: item.sessionId,
    taskId: item.taskId,
  };
}

function idlePendingCards(
  sessions: readonly CoworkSessionSummary[],
  reservedSessionIds: Set<string>,
  workspaces: readonly { id: string; name: string }[],
): TaskBoardCard[] {
  const cards: TaskBoardCard[] = [];
  for (const session of sessions) {
    if (session.mode === CoworkSessionMode.Chat) continue;
    if (session.source !== CoworkSessionSource.Manual) continue;
    if (session.status !== CoworkSessionStatus.Idle) continue;
    if (reservedSessionIds.has(session.id)) continue;
    cards.push({
      id: `idle:${session.id}`,
      title: session.title,
      detailKey: 'taskBoardIdleWork',
      projectLabel: workspaceName(session.workspaceId ?? undefined, workspaces),
      timestamp: session.updatedAt,
      target: BriefingTarget.Session,
      sessionId: session.id,
    });
  }
  cards.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
  return cards;
}

/** Kanban projection over the same SQLite-backed inputs as the work briefing. */
export function buildTaskBoardColumns(input: TaskBoardProjectionInput): TaskBoardColumns {
  const briefing = buildWorkBriefing(input);
  const cardContext = {
    sessions: input.sessions,
    schedules: input.schedules,
    workspaces: input.workspaces,
  };

  const awaitingConfirm = briefing.decisions.map(item => cardFromBriefing(item, cardContext));
  const inProgress = briefing.progressed
    .filter(item => item.running)
    .map(item => cardFromBriefing(item, cardContext));
  const completed = briefing.progressed
    .filter(item => !item.running)
    .map(item => cardFromBriefing(item, cardContext));

  const needsAttentionItems = briefing.next.filter(item => item.reasonKey === 'briefingInspectWork');
  const upcomingItems = briefing.next.filter(item => item.reasonKey === 'briefingUpcomingSchedule');

  const needsAttention = needsAttentionItems.map(item =>
    cardFromBriefing(item, { ...cardContext, needsAttention: true }),
  );
  const pendingFromBriefing = upcomingItems.map(item => cardFromBriefing(item, cardContext));

  const reserved = new Set<string>();
  for (const item of [
    ...awaitingConfirm,
    ...inProgress,
    ...completed,
    ...needsAttention,
    ...pendingFromBriefing,
  ]) {
    if (item.sessionId) reserved.add(item.sessionId);
  }

  const pending = [...pendingFromBriefing, ...idlePendingCards(input.sessions, reserved, input.workspaces)];

  return {
    [TaskBoardColumnId.AwaitingConfirm]: awaitingConfirm,
    [TaskBoardColumnId.InProgress]: inProgress,
    [TaskBoardColumnId.NeedsAttention]: needsAttention,
    [TaskBoardColumnId.Completed]: completed,
    [TaskBoardColumnId.Pending]: pending,
  };
}
