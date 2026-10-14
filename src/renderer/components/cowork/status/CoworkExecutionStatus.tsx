import { Button } from '@shared/components/ui/button';
import { Badge } from '@shared/components/ui/badge';
import { useEffect, useRef, useState } from 'react';
import { i18nService } from '../../../services/i18n';
import { DurableRecoveryDetails } from '../durable/DurableRecoveryCard';
import { useDurableWorkSnapshot } from '../durable/useDurableWorkSnapshot';
import { executionPresentation } from './executionPresentation';

export function CoworkExecutionStatus({
  sessionId,
  isStreaming,
  awaitingReply,
  stopping,
  stopFailed,
  onStop,
  onConversation,
  onReview,
}: {
  sessionId: string;
  isStreaming: boolean;
  awaitingReply: boolean;
  stopping: boolean;
  stopFailed: boolean;
  onStop(): void;
  onConversation(): void;
  onReview(): void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined' || !root.current) return;
    const observer = new IntersectionObserver(entries =>
      setVisible(entries.some(entry => entry.isIntersecting)),
    );
    observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  const state = useDurableWorkSnapshot(sessionId, visible, isStreaming);
  const [, setLanguage] = useState(i18nService.getLanguage());
  useEffect(() => i18nService.subscribe(() => setLanguage(i18nService.getLanguage())), []);
  const refresh = state.refresh;
  const wasStopping = useRef(stopping);
  useEffect(() => {
    if (wasStopping.current && !stopping) void refresh();
    wasStopping.current = stopping;
  }, [stopping, refresh]);
  const status = executionPresentation(state.snapshot, state.loadFailed, awaitingReply);
  const canStop = ['running', 'waiting', 'paused', 'queued'].includes(status);
  const t = (key: string) => i18nService.t(key);
  return (
    <div
      ref={root}
      className="max-h-64 shrink-0 overflow-y-auto border-b border-border-subtle px-4 py-2"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" role="status">
          {t(stopping ? 'executionStopping' : `execution_${status}`)}
        </Badge>
        {status === 'waiting' && (
          <Button size="sm" onClick={onReview}>
            {t('executionReview')}
          </Button>
        )}
        {(status === 'failed' || status === 'queued') && (
          <Button size="sm" variant="outline" onClick={onConversation}>
            {t(status === 'queued' ? 'executionQueue' : 'executionRevise')}
          </Button>
        )}
        {canStop && (
          <Button
            size="sm"
            variant="outline"
            disabled={stopping || state.resuming || state.loading}
            onClick={onStop}
          >
            {t('executionStop')}
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          disabled={state.loading || state.resuming || stopping}
          onClick={() => void state.refresh()}
        >
          {t('executionRefresh')}
        </Button>
      </div>
      {status === 'completed' && (
        <p className="mt-1 text-xs text-muted-foreground">{t('executionCompletedHint')}</p>
      )}
      {status === 'stopped' && (
        <p className="mt-1 text-xs text-muted-foreground">{t('executionStoppedHint')}</p>
      )}
      {status === 'failed' && (
        <p className="mt-1 text-xs text-muted-foreground">{t('executionFailedHint')}</p>
      )}
      {stopFailed && (
        <p role="alert" className="mt-1 text-sm text-destructive">
          {t('executionStopFailed')}
        </p>
      )}
      <DurableRecoveryDetails state={state} disabled={stopping} compact />
    </div>
  );
}
