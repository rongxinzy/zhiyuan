import { Button } from '@shared/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader } from '@shared/components/ui/empty';
import { Separator } from '@shared/components/ui/separator';
import { cn } from '@shared/lib/utils';
import React, { useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { coworkService } from '../../../services/cowork';
import { i18nService } from '../../../services/i18n';
import { showAppErrorToast } from '../../../services/toastNotification';
import type { RootState } from '../../../store';
import { selectTask } from '../../../store/slices/scheduledTaskSlice';
import MarkdownContent from '../../MarkdownContent';
import { BRIEFING_CLOCK_INTERVAL_MS, BriefingTarget } from './constants';
import { buildWorkBriefing, pageBriefingItems, type BriefingItem } from './projection';
import { useBriefingData } from './useBriefingData';

interface WorkBriefingHomeProps {
  header: React.ReactNode;
  prompt: React.ReactNode;
  onFocusInput: () => void;
  onShowScheduledTasks?: () => void;
}

export function WorkBriefingHome({
  header,
  prompt,
  onFocusInput,
  onShowScheduledTasks,
}: WorkBriefingHomeProps) {
  const dispatch = useDispatch();
  const sessions = useSelector((state: RootState) => state.cowork.sessions);
  const permissions = useSelector((state: RootState) => state.cowork.pendingPermissions);
  const activities = useSelector((state: RootState) => state.activity.runs);
  const schedules = useSelector((state: RootState) => state.scheduledTask.tasks);
  const scheduleError = useSelector((state: RootState) => state.scheduledTask.listError);
  const [language, setLanguage] = useState(i18nService.getLanguage());
  const [now, setNow] = useState(Date.now);
  const [expandedRecords, setExpandedRecords] = useState<Set<string>>(() => new Set());
  const [pages, setPages] = useState<Record<string, number>>({});
  const { loading, loadFailed, refresh } = useBriefingData();
  const briefing = useMemo(
    () =>
      buildWorkBriefing({
        sessions,
        permissions,
        activities,
        schedules,
        now,
      }),
    [sessions, permissions, activities, schedules, now],
  );

  useEffect(() => {
    setPages(previous => {
      const next = {
        briefingDecisions: pageBriefingItems(briefing.decisions, previous.briefingDecisions ?? 0)
          .page,
        briefingProgressed: pageBriefingItems(briefing.progressed, previous.briefingProgressed ?? 0)
          .page,
        briefingNext: pageBriefingItems(briefing.next, previous.briefingNext ?? 0).page,
      };
      return Object.entries(next).every(([key, value]) => (previous[key] ?? 0) === value)
        ? previous
        : next;
    });
  }, [briefing]);

  useEffect(() => i18nService.subscribe(() => setLanguage(i18nService.getLanguage())), []);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), BRIEFING_CLOCK_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, []);

  const openItem = (item: BriefingItem) => {
    if (item.target === BriefingTarget.Session && item.sessionId) {
      void coworkService
        .loadSession(item.sessionId)
        .then(session => {
          if (!session) showAppErrorToast(i18nService.t('briefingOpenFailed'));
        })
        .catch(() => showAppErrorToast(i18nService.t('briefingOpenFailed')));
    } else if (item.target === BriefingTarget.Schedule && item.taskId) {
      dispatch(selectTask(item.taskId));
      onShowScheduledTasks?.();
    } else if (item.target === BriefingTarget.Activity) {
      setExpandedRecords(previous => {
        const next = new Set(previous);
        if (next.has(item.id)) next.delete(item.id);
        else next.add(item.id);
        return next;
      });
    }
  };
  const sections = [
    {
      title: 'briefingDecisions',
      empty: 'briefingNoDecisions',
      items: briefing.decisions,
      count: briefing.decisionCount,
    },
    {
      title: 'briefingProgressed',
      empty: 'briefingNoProgress',
      items: briefing.progressed,
      count: briefing.progressedCount,
    },
    {
      title: 'briefingNext',
      empty: 'briefingNoNext',
      items: briefing.next,
      count: briefing.nextCount,
    },
  ];
  const failed = loadFailed || Boolean(scheduleError);

  return (
    <div data-page-canvas className="flex h-full min-h-0 flex-1 flex-col">
      {header}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-4xl min-w-0 flex-col gap-6 px-6 py-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="theme-home-caption">{i18nService.t('briefingScope')}</p>
            <Button variant="ghost" size="sm" disabled={loading} onClick={() => void refresh()}>
              {i18nService.t('briefingRefresh')}
            </Button>
          </div>
          {loading && (
            <p role="status" className="theme-home-caption">
              {i18nService.t('briefingLoading')}
            </p>
          )}
          {failed && (
            <p role="alert" className="theme-home-caption">
              {i18nService.t('briefingLoadFailed')}
            </p>
          )}
          {!loading && !failed && !briefing.hasHistory ? (
            <Empty>
              <EmptyHeader>
                <EmptyDescription>{i18nService.t('briefingNewWork')}</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button onClick={onFocusInput}>{i18nService.t('briefingStartWork')}</Button>
              </EmptyContent>
            </Empty>
          ) : (
            <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-3">
              {sections.map(section => {
                const page = pageBriefingItems(section.items, pages[section.title] ?? 0);
                return (
                  <section
                    key={section.title}
                    aria-labelledby={section.title}
                    className="flex min-w-0 flex-col gap-4"
                  >
                    <h2 id={section.title} className="theme-card-title">
                      {i18nService.t(section.title)} · {section.count}
                    </h2>
                    {section.items.length === 0 ? (
                      <p className="theme-home-caption">
                        {i18nService.t(
                          loading
                            ? 'briefingLoading'
                            : failed
                              ? 'briefingUnavailable'
                              : section.empty,
                        )}
                      </p>
                    ) : (
                      <ul className="flex min-w-0 flex-col gap-4">
                        {page.items.map(item => (
                          <li key={item.id} className="flex min-w-0 flex-col gap-2">
                            <p
                              className={cn(
                                'theme-card-title break-words',
                                !expandedRecords.has(item.id) && 'line-clamp-2',
                              )}
                              title={item.title}
                            >
                              {item.title || i18nService.t('briefingUntitled')}
                            </p>
                            <p className="theme-home-caption">{i18nService.t(item.reasonKey)}</p>
                            {(item.description || item.descriptionKey) && (
                              <div
                                className={cn(
                                  'theme-home-caption min-w-0 break-words overflow-hidden',
                                  !expandedRecords.has(item.id) && 'line-clamp-3',
                                )}
                              >
                                <MarkdownContent
                                  content={
                                    item.descriptionKey
                                      ? i18nService.t(item.descriptionKey)
                                      : (item.description ?? '')
                                  }
                                />
                              </div>
                            )}
                            {item.timestamp !== undefined && (
                              <time
                                className="theme-home-status"
                                dateTime={new Date(item.timestamp).toISOString()}
                              >
                                {new Date(item.timestamp).toLocaleString(
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
                            <div className="flex flex-wrap gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => openItem(item)}
                                aria-expanded={
                                  item.target === BriefingTarget.Activity
                                    ? expandedRecords.has(item.id)
                                    : undefined
                                }
                                disabled={
                                  item.target === BriefingTarget.Schedule && !onShowScheduledTasks
                                }
                              >
                                {i18nService.t(
                                  item.target === BriefingTarget.Schedule
                                    ? 'briefingViewSchedule'
                                    : item.target === BriefingTarget.Activity
                                      ? expandedRecords.has(item.id)
                                        ? 'briefingCollapseRecord'
                                        : 'briefingViewActivity'
                                      : 'briefingViewWork',
                                )}
                              </Button>
                              {item.target === BriefingTarget.Activity && item.sessionId && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() =>
                                    openItem({ ...item, target: BriefingTarget.Session })
                                  }
                                >
                                  {i18nService.t('briefingViewWork')}
                                </Button>
                              )}
                            </div>
                            <Separator />
                          </li>
                        ))}
                      </ul>
                    )}
                    {page.pageCount > 1 && (
                      <nav
                        aria-label={`${i18nService.t(section.title)} · ${i18nService.t('briefingPages')}`}
                        className="flex flex-wrap items-center gap-2"
                      >
                        <p
                          role="status"
                          aria-live="polite"
                          aria-atomic="true"
                          className="theme-home-caption w-full"
                        >
                          {i18nService
                            .t('briefingPageRange')
                            .replace('{from}', String(page.from))
                            .replace('{to}', String(page.to))
                            .replace('{count}', String(section.count))}
                        </p>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={page.page === 0}
                          onClick={() =>
                            setPages(previous => ({ ...previous, [section.title]: page.page - 1 }))
                          }
                        >
                          {i18nService.t('briefingPreviousPage')}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={page.page + 1 >= page.pageCount}
                          onClick={() =>
                            setPages(previous => ({ ...previous, [section.title]: page.page + 1 }))
                          }
                        >
                          {i18nService.t('briefingNextPage')}
                        </Button>
                      </nav>
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </div>
      </div>
      <div className="shrink-0 px-6 pb-4 pt-2">
        <div className="mx-auto w-full max-w-3xl min-w-0">{prompt}</div>
      </div>
    </div>
  );
}
