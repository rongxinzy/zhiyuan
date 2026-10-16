import { Button } from '@shared/components/ui/button';
import { Textarea } from '@shared/components/ui/textarea';
import { cn } from '@shared/lib/utils';
import { X } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { TaskBoardThreadAuthor } from '../../../shared/taskBoard/constants';
import { formatActivityError } from '../activity/utils';
import { buildPermissionBriefingHeadline } from '../cowork/briefing/permissionHeadline';
import { formatBriefingTemplate } from '../cowork/briefing/briefingCopy';
import { i18nService } from '../../services/i18n';
import { coworkService } from '../../services/cowork';
import type { RootState } from '../../store';
import { CoworkPermissionBehavior } from '../../../shared/cowork/constants';
import { selectSessionArtifacts } from '../../store/slices/artifactSlice';
import {
  appendTaskBoardThreadEntry,
  selectTaskBoardCard,
} from '../../store/slices/taskBoardSlice';
import type { TaskBoardCard } from './taskBoardProjection';
import { submitTaskBoardComment } from './submitTaskBoardComment';
import { resolveTaskBoardThreadKey } from './taskBoardThreadKey';

function resolveCardDetail(card: TaskBoardCard): string {
  if (card.activityErrorMessage) {
    return formatActivityError(card.activityErrorMessage);
  }
  if (card.detailParams) {
    return formatBriefingTemplate(card.detailKey, card.detailParams);
  }
  return i18nService.t(card.detailKey);
}

interface TaskBoardDetailPanelProps {
  card: TaskBoardCard;
  columnLabel: string;
}

export function TaskBoardDetailPanel({ card, columnLabel }: TaskBoardDetailPanelProps) {
  const dispatch = useDispatch();
  const threadKey = resolveTaskBoardThreadKey(card);
  const thread = useSelector((state: RootState) => state.taskBoard.threads[threadKey] ?? []);
  const conclusion =
    useSelector((state: RootState) => state.taskBoard.conclusionByThreadKey[threadKey]) ??
    resolveCardDetail(card);
  const permission = useSelector((state: RootState) =>
    card.sessionId
      ? state.cowork.pendingPermissions.find(entry => entry.sessionId === card.sessionId)
      : undefined,
  );
  const artifacts = useSelector((state: RootState) =>
    card.sessionId ? selectSessionArtifacts(state, card.sessionId) : [],
  );
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const permissionHeadline = useMemo(() => {
    if (!permission) return null;
    const headline = buildPermissionBriefingHeadline(permission);
    return formatBriefingTemplate(headline.i18nKey, headline.params);
  }, [permission]);

  const close = useCallback(() => {
    dispatch(selectTaskBoardCard(null));
  }, [dispatch]);

  const respond = useCallback(
    async (behavior: 'allow' | 'deny') => {
      if (!permission) return;
      await coworkService.respondToPermission(
        permission.requestId,
        behavior === 'allow'
          ? { behavior: CoworkPermissionBehavior.Allow, updatedInput: permission.toolInput }
          : { behavior: CoworkPermissionBehavior.Deny, message: 'Permission denied' },
      );
      dispatch(
        appendTaskBoardThreadEntry({
          threadKey,
          author: TaskBoardThreadAuthor.System,
          body:
            behavior === 'allow'
              ? 'taskBoardPermissionApproved'
              : 'taskBoardPermissionDenied',
        }),
      );
    },
    [dispatch, permission, threadKey],
  );

  const onSubmitComment = useCallback(async () => {
    if (!card.sessionId || !comment.trim()) return;
    setSubmitting(true);
    try {
      await submitTaskBoardComment({
        dispatch,
        threadKey,
        sessionId: card.sessionId,
        comment,
      });
      setComment('');
    } finally {
      setSubmitting(false);
    }
  }, [card.sessionId, comment, dispatch, threadKey]);

  return (
    <aside
      className="theme-task-board-detail flex h-full min-h-0 w-[22rem] shrink-0 flex-col border-l border-border"
      data-testid="task-board-detail-panel"
    >
      <div className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <p className="theme-home-caption">{columnLabel}</p>
          <h2 className="theme-task-board-card-title line-clamp-2">{card.title}</h2>
          {card.projectLabel ? (
            <p className="theme-task-board-card-project mt-1">{card.projectLabel}</p>
          ) : null}
        </div>
        <Button type="button" variant="ghost" size="icon-xs" onClick={close} aria-label={i18nService.t('close')}>
          <X className="size-4" aria-hidden="true" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <section className="mb-4">
          <h3 className="theme-task-board-column-title mb-2 uppercase">
            {i18nService.t('taskBoardDetailConclusion')}
          </h3>
          <p className="theme-task-board-card-meta whitespace-pre-wrap">{conclusion}</p>
        </section>
        {permission && permissionHeadline ? (
          <section className="mb-4 rounded-lg border border-border p-3">
            <p className="theme-task-board-card-meta mb-3">{permissionHeadline}</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" onClick={() => void respond('allow')}>
                {i18nService.t('coworkApprove')}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => void respond('deny')}>
                {i18nService.t('coworkDeny')}
              </Button>
            </div>
          </section>
        ) : null}
        {artifacts.length > 0 ? (
          <section className="mb-4">
            <h3 className="theme-task-board-column-title mb-2 uppercase">
              {i18nService.t('taskBoardDetailArtifacts')}
            </h3>
            <ul className="flex flex-col gap-1">
              {artifacts.slice(0, 6).map(artifact => (
                <li key={artifact.id} className="theme-task-board-card-meta truncate">
                  {artifact.title || artifact.filePath || artifact.id}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <section>
          <h3 className="theme-task-board-column-title mb-2 uppercase">
            {i18nService.t('taskBoardDetailThread')}
          </h3>
          <ul className="flex flex-col gap-2" data-testid="task-board-thread">
            {thread.length === 0 ? (
              <li className="theme-home-caption">{i18nService.t('taskBoardThreadEmpty')}</li>
            ) : (
              thread.map(entry => (
                <li
                  key={entry.id}
                  className={cn(
                    'rounded-md border border-border px-2 py-1.5 text-sm',
                    entry.author === TaskBoardThreadAuthor.User && 'bg-muted/40',
                  )}
                >
                  <span className="theme-home-status block text-xs">
                    {entry.author === TaskBoardThreadAuthor.User
                      ? i18nService.t('taskBoardThreadYou')
                      : entry.author === TaskBoardThreadAuthor.Ai
                        ? i18nService.t('taskBoardThreadAi')
                        : i18nService.t('taskBoardThreadSystem')}
                  </span>
                  <span className="theme-task-board-card-meta whitespace-pre-wrap">
                    {entry.author === TaskBoardThreadAuthor.System
                      ? i18nService.t(entry.body)
                      : entry.body}
                  </span>
                </li>
              ))
            )}
          </ul>
        </section>
      </div>
      {card.sessionId ? (
        <div className="border-t border-border p-3">
          <Textarea
            value={comment}
            onChange={event => setComment(event.target.value)}
            placeholder={i18nService.t('taskBoardCommentPlaceholder')}
            rows={2}
            className="mb-2 min-h-0 resize-none text-sm"
            data-testid="task-board-comment-input"
          />
          <Button
            type="button"
            size="sm"
            className="w-full"
            disabled={submitting || !comment.trim()}
            onClick={() => void onSubmitComment()}
          >
            {i18nService.t('taskBoardCommentSubmit')}
          </Button>
        </div>
      ) : null}
    </aside>
  );
}
