import { Badge } from '@shared/components/ui/badge';
import { Button } from '@shared/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@shared/components/ui/collapsible';
import { FileDiff, Files, Terminal } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { CodingLaneStatus } from '../../../shared/codingAgent';
import type { CodingConversationTurn } from './codingEventProjection';
import { CodingConversationTurnStatus } from './constants';
import { selectCodingTaskOverview } from './codingTaskOverview';
import { i18nService } from '../../services/i18n';

const statusKeys: Record<CodingLaneStatus, string> = {
  idle: 'codingWorkIdle',
  running: 'codingWorkRunning',
  waiting_approval: 'codingWorkApproval',
  waiting_elicitation: 'codingWorkQuestion',
  needs_auth: 'codingWorkAuth',
  disconnected: 'codingWorkDisconnected',
  completed: 'codingWorkEnded',
  failed: 'codingWorkFailed',
};

export function CodingTaskOverview({
  sourceRoot,
  taskTitle,
  status,
  turns,
  hasOutput,
  agents,
  tools,
  onReview,
  onFiles,
  onOutput,
}: {
  sourceRoot: string;
  taskTitle?: string;
  status: CodingLaneStatus | null;
  turns: readonly CodingConversationTurn[];
  hasOutput: boolean;
  onReview(): void;
  onFiles(): void;
  onOutput(): void;
  agents?: ReactNode;
  tools?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const context = useMemo(() => selectCodingTaskOverview(turns), [turns]);
  const t = (key: string) => i18nService.t(key);
  const title = context.request || taskTitle || t('codingWorkNewTask');
  const settledKey =
    context.settledStatus === CodingConversationTurnStatus.Failed
      ? 'codingWorkFailed'
      : context.settledStatus === CodingConversationTurnStatus.Cancelled
        ? 'codingWorkCancelled'
        : 'codingWorkEnded';
  return (
    <section
      aria-label={t('codingWorkContext')}
      className="flex max-h-64 shrink-0 min-w-0 flex-col gap-2 overflow-y-auto border-b border-border-subtle px-4 py-3"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <p className="theme-card-title min-w-0 flex-1 truncate" title={title}>
          {title}
        </p>
        <Badge variant="outline" role="status" aria-live="polite">
          {t(status ? statusKeys[status] : 'codingWorkDraft')}
        </Badge>
      </div>
      <p className="theme-home-caption truncate" title={sourceRoot}>
        {sourceRoot}
      </p>
      {agents && <div className="flex min-w-0 flex-wrap items-center gap-2">{agents}</div>}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={onReview}>
          <FileDiff data-icon="inline-start" />
          {t('codingWorkDiff')}
        </Button>
        <Button variant="ghost" size="sm" onClick={onFiles}>
          <Files data-icon="inline-start" />
          {t('codingWorkFiles')}
        </Button>
        <Button variant="ghost" size="sm" disabled={!hasOutput} onClick={onOutput}>
          <Terminal data-icon="inline-start" />
          {t('codingWorkOutput')}
        </Button>
        {tools}
      </div>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger render={<Button variant="ghost" size="sm" />}>
          {t(context.previousTurn ? 'codingWorkPreviousResult' : 'codingWorkLatestResult')}
        </CollapsibleTrigger>
        {!open && (
          <p className="theme-home-caption line-clamp-2 break-words">
            {(context.detail || context.result).slice(0, 240) || t('codingWorkNoResult')}
          </p>
        )}
        <CollapsibleContent>
          <div className="flex max-h-48 min-w-0 flex-col gap-2 overflow-y-auto py-2">
            <p className="theme-home-caption">{t('codingWorkResultScope')}</p>
            {context.settledStatus && <p className="theme-home-status">{t(settledKey)}</p>}
            <p className="theme-home-caption whitespace-pre-wrap break-words">
              {(context.detail || context.result).slice(0, 1200) || t('codingWorkNoResult')}
            </p>
            {(context.detail || context.result).length > 1200 && (
              <p className="theme-home-caption">{t('codingWorkResultTruncated')}</p>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}
