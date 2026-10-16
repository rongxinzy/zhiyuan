import { CoworkSessionMode, CoworkSessionSource, CoworkSessionStatus } from '../../../shared/cowork/constants';
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
  timestamp?: number;
  target: BriefingItem['target'];
  sessionId?: string;
  taskId?: string;
}

export type TaskBoardColumns = Record<ColumnId, TaskBoardCard[]>;

function cardFromBriefing(item: BriefingItem): TaskBoardCard {
  return {
    id: item.id,
    title: item.title || item.reasonKey,
    detailKey: item.headlineI18nKey ?? item.reasonKey,
    detailParams: item.headlineI18nParams,
    timestamp: item.timestamp,
    target: item.target,
    sessionId: item.sessionId,
    taskId: item.taskId,
  };
}

function idlePendingCards(sessions: readonly CoworkSessionSummary[], reservedSessionIds: Set<string>) {
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
      timestamp: session.updatedAt,
      target: BriefingTarget.Session,
      sessionId: session.id,
    });
  }
  cards.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
  return cards;
}

/** Kanban projection over the same SQLite-backed inputs as the work briefing. */
export function buildTaskBoardColumns(input: BriefingInput): TaskBoardColumns {
  const briefing = buildWorkBriefing(input);
  const awaitingConfirm = briefing.decisions.map(cardFromBriefing);
  const inProgress = briefing.progressed.filter(item => item.running).map(cardFromBriefing);
  const completed = briefing.progressed.filter(item => !item.running).map(cardFromBriefing);
  const pendingFromBriefing = briefing.next.map(cardFromBriefing);

  const reserved = new Set<string>();
  for (const item of [...awaitingConfirm, ...inProgress, ...completed, ...pendingFromBriefing]) {
    if (item.sessionId) reserved.add(item.sessionId);
  }

  const pending = [...pendingFromBriefing, ...idlePendingCards(input.sessions, reserved)];

  return {
    [TaskBoardColumnId.AwaitingConfirm]: awaitingConfirm,
    [TaskBoardColumnId.InProgress]: inProgress,
    [TaskBoardColumnId.Completed]: completed,
    [TaskBoardColumnId.Pending]: pending,
  };
}
