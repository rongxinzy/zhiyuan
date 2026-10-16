import { Button } from '@shared/components/ui/button';
import { cn } from '@shared/lib/utils';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';

import { i18nService } from '../../services/i18n';
import { coworkService } from '../../services/cowork';
import type { RootState } from '../../store';
import PageHeader from '../PageHeader';
import { BriefingTarget } from '../cowork/briefing/constants';
import { formatBriefingTemplate } from '../cowork/briefing/briefingCopy';
import { useBriefingData } from '../cowork/briefing/useBriefingData';
import { TASK_BOARD_COLUMN_ORDER, TaskBoardColumnId } from './constants';
import { buildTaskBoardColumns, type TaskBoardCard } from './taskBoardProjection';

const columnTitleKey: Record<(typeof TaskBoardColumnId)[keyof typeof TaskBoardColumnId], string> = {
  [TaskBoardColumnId.Pending]: 'taskBoardColumnPending',
  [TaskBoardColumnId.InProgress]: 'taskBoardColumnInProgress',
  [TaskBoardColumnId.AwaitingConfirm]: 'taskBoardColumnAwaitingConfirm',
  [TaskBoardColumnId.Completed]: 'taskBoardColumnCompleted',
};

interface TaskBoardViewProps {
  isSidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  onNewChat?: () => void;
  updateBadge?: React.ReactNode;
  onShowScheduledTasks?: () => void;
  onOpenCowork?: () => void;
}

function resolveCardDetail(card: TaskBoardCard): string {
  if (card.detailParams) {
    return formatBriefingTemplate(card.detailKey, card.detailParams);
  }
  return i18nService.t(card.detailKey);
}

export function TaskBoardView({
  isSidebarCollapsed,
  onToggleSidebar,
  onNewChat,
  updateBadge,
  onShowScheduledTasks,
  onOpenCowork,
}: TaskBoardViewProps) {
  const sessions = useSelector((state: RootState) => state.cowork.sessions);
  const permissions = useSelector((state: RootState) => state.cowork.pendingPermissions);
  const activities = useSelector((state: RootState) => state.activity.runs);
  const schedules = useSelector((state: RootState) => state.scheduledTask.tasks);
  const [language, setLanguage] = useState(i18nService.getLanguage());
  const [now, setNow] = useState(Date.now);
  const { loading, loadFailed, refresh } = useBriefingData();

  const columns = useMemo(
    () =>
      buildTaskBoardColumns({
        sessions,
        permissions,
        activities,
        schedules,
        now,
      }),
    [sessions, permissions, activities, schedules, now],
  );

  useEffect(() => i18nService.subscribe(() => setLanguage(i18nService.getLanguage())), []);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const openCard = useCallback(
    async (card: TaskBoardCard) => {
      if (card.target === BriefingTarget.Session && card.sessionId) {
        await coworkService.loadSession(card.sessionId);
        onOpenCowork?.();
        return;
      }
      if (card.target === BriefingTarget.Schedule && card.taskId) {
        onShowScheduledTasks?.();
        return;
      }
      if (card.target === BriefingTarget.Activity && card.sessionId) {
        await coworkService.loadSession(card.sessionId);
        onOpenCowork?.();
      }
    },
    [onOpenCowork, onShowScheduledTasks],
  );

  return (
    <div data-page-canvas className="flex h-full min-h-0 flex-1 flex-col">
      <PageHeader
        title={i18nService.t('taskBoardTitle')}
        isSidebarCollapsed={isSidebarCollapsed}
        onToggleSidebar={onToggleSidebar}
        onNewChat={onNewChat}
        updateBadge={updateBadge}
      />
      <div className="min-h-0 flex-1 overflow-x-auto overflow-y-auto px-6 py-6">
        <div className="mx-auto flex w-full max-w-[80rem] min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="theme-home-caption">{i18nService.t('taskBoardScope')}</p>
            <Button variant="ghost" size="sm" disabled={loading} onClick={() => void refresh()}>
              {i18nService.t('briefingRefresh')}
            </Button>
          </div>
          {loading && (
            <p role="status" className="theme-home-caption">
              {i18nService.t('briefingLoading')}
            </p>
          )}
          {loadFailed && (
            <p role="alert" className="theme-home-caption">
              {i18nService.t('briefingLoadFailed')}
            </p>
          )}
          <div
            className="grid min-w-[56rem] grid-cols-4 gap-4"
            data-testid="task-board-columns"
            lang={language}
          >
            {TASK_BOARD_COLUMN_ORDER.map(columnId => {
              const cards = columns[columnId];
              return (
                <section
                  key={columnId}
                  className="theme-task-board-column flex min-w-0 flex-col"
                  aria-label={i18nService.t(columnTitleKey[columnId])}
                >
                  <h2 className="theme-task-board-column-title uppercase">
                    {i18nService.t(columnTitleKey[columnId])} · {cards.length}
                  </h2>
                  <ul className="flex min-h-0 flex-col gap-2">
                    {cards.length === 0 ? (
                      <li className="theme-home-caption px-1 py-2">
                        {i18nService.t('taskBoardColumnEmpty')}
                      </li>
                    ) : (
                      cards.map(card => (
                        <li key={card.id}>
                          <button
                            type="button"
                            className={cn('theme-task-board-card flex flex-col')}
                            onClick={() => void openCard(card)}
                          >
                            <span className="theme-task-board-card-title line-clamp-2">
                              {card.title}
                            </span>
                            <span className="theme-task-board-card-meta line-clamp-2">
                              {resolveCardDetail(card)}
                            </span>
                            {card.timestamp !== undefined && (
                              <time
                                className="theme-home-status"
                                dateTime={new Date(card.timestamp).toISOString()}
                              >
                                {new Date(card.timestamp).toLocaleString(
                                  language === 'zh' ? 'zh-CN' : 'en-US',
                                  {
                                    month: 'short',
                                    day: 'numeric',
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  },
                                )}
                              </time>
                            )}
                          </button>
                        </li>
                      ))
                    )}
                  </ul>
                </section>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

export default TaskBoardView;
