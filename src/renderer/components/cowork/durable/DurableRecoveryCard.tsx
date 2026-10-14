import { Badge } from '@shared/components/ui/badge';
import { Button } from '@shared/components/ui/button';
import { useEffect, useState } from 'react';

import { i18nService } from '../../../services/i18n';
import { PermissionRequestCard } from '../../permission/PermissionRequestCard';
import { DurableResumeBlockedReason, DurableScheduling } from './constants';
import { useDurableWorkSnapshot } from './useDurableWorkSnapshot';

interface DurableRecoveryCardProps {
  sessionId: string;
  disabled?: boolean;
  compact?: boolean;
}

/** A native continuation is a user action, distinct from accepting a finished result. */
export function DurableRecoveryCard({
  sessionId,
  disabled = false,
  compact = false,
}: DurableRecoveryCardProps) {
  const state = useDurableWorkSnapshot(sessionId);
  return <DurableRecoveryDetails state={state} disabled={disabled} compact={compact} />;
}

export function DurableRecoveryDetails({
  state,
  disabled = false,
  compact = false,
}: {
  state: ReturnType<typeof useDurableWorkSnapshot>;
  disabled?: boolean;
  compact?: boolean;
}) {
  const { snapshot, loading, loadFailed, resumeFailed, resuming, refresh, resume } = state;
  const [, setLanguage] = useState(i18nService.getLanguage());
  useEffect(() => i18nService.subscribe(() => setLanguage(i18nService.getLanguage())), []);

  if (!snapshot && !loadFailed) return null;
  if (snapshot && snapshot.scheduling !== DurableScheduling.Paused && !loadFailed && !resumeFailed)
    return null;
  if (
    snapshot?.pendingSubmissionCount === 0 &&
    !snapshot.tasks.length &&
    !loadFailed &&
    !resumeFailed
  )
    return null;

  const blockedKey =
    snapshot?.blockedReason === DurableResumeBlockedReason.MissingTaskDefinition
      ? 'durableRecoveryMissingDefinition'
      : snapshot?.blockedReason === DurableResumeBlockedReason.Closing
        ? 'durableRecoveryClosing'
        : snapshot?.blockedReason === DurableResumeBlockedReason.AlreadyRunning
          ? 'durableRecoveryRunning'
          : snapshot?.blockedReason === DurableResumeBlockedReason.NoPendingWork
            ? 'durableRecoveryNoPending'
            : 'durableRecoveryUnavailable';

  return (
    <PermissionRequestCard
      className="mt-3"
      header={
        <>
          <span>{i18nService.t('durableRecoveryTitle')}</span>
          {snapshot && (
            <Badge variant="outline" className="ml-auto">
              {i18nService.t(
                snapshot.scheduling === DurableScheduling.Paused
                  ? 'durableRecoveryPaused'
                  : snapshot.scheduling === DurableScheduling.Running
                    ? 'durableRecoveryRunning'
                    : 'durableRecoveryClosing',
              )}
            </Badge>
          )}
        </>
      }
      footer={
        <>
          <Button
            type="button"
            variant="ghost"
            disabled={loading || resuming}
            onClick={() => void refresh()}
          >
            {i18nService.t('durableRecoveryRefresh')}
          </Button>
          {(snapshot?.canResume || snapshot?.resumeRequiresCheck) && (
            <Button
              type="button"
              disabled={disabled || loading || loadFailed || resuming}
              onClick={() => void resume()}
            >
              {i18nService.t(
                resuming
                  ? 'durableRecoveryResuming'
                  : snapshot?.resumeRequiresCheck
                    ? 'executionCheckResume'
                    : 'durableRecoveryResume',
              )}
            </Button>
          )}
        </>
      }
    >
      {loadFailed && (
        <p role="alert" className="theme-home-caption">
          {i18nService.t('durableRecoveryLoadFailed')}
        </p>
      )}
      {resumeFailed && (
        <p role="alert" className="theme-home-caption">
          {i18nService.t('durableRecoveryResumeFailed')}
        </p>
      )}
      {snapshot && (
        <>
          <p className="theme-home-caption">
            {i18nService
              .t(snapshot.pendingTruncated ? 'executionPendingLimited' : 'durableRecoveryPending')
              .replace('{count}', String(snapshot.pendingSubmissionCount))}
          </p>
          <details open={compact ? undefined : true} className="flex min-w-0 flex-col gap-2">
            <summary className="theme-card-title cursor-pointer">
              {i18nService.t('durableRecoveryLastRecord')}
            </summary>
            <p className="theme-home-caption whitespace-pre-wrap break-words">
              {snapshot.lastCommittedEntry?.text || i18nService.t('durableRecoveryNoRecord')}
            </p>
          </details>
          <p className="theme-home-caption">{i18nService.t('durableRecoveryEffectsUnknown')}</p>
          {!snapshot.canResume && !snapshot.resumeRequiresCheck && (
            <p className="theme-home-caption">{i18nService.t(blockedKey)}</p>
          )}
        </>
      )}
    </PermissionRequestCard>
  );
}
