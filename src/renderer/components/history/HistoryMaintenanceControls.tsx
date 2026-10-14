import { useEffect, useRef, useState } from 'react';
import { Archive, RotateCcw } from 'lucide-react';
import type { HistoryApi } from '@shared/history';
import { Button } from '@shared/components/ui/button';
import { Alert, AlertDescription } from '@shared/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogFooterSurface,
  DialogHeader,
  DialogTitle,
} from '@shared/components/ui/dialog';
import { i18nService } from '../../services/i18n';
import { HistoryMaintenanceKind, HistoryMaintenancePhase } from './constants';

type MaintenanceApi = Pick<
  HistoryApi,
  'selectMaintenance' | 'confirmMaintenance' | 'maintenanceStatus'
>;
type SelectionResult = Awaited<ReturnType<MaintenanceApi['selectMaintenance']>>;
type Selection = NonNullable<Extract<SelectionResult, { success: true }>['data']>;
type StatusResult = Awaited<ReturnType<MaintenanceApi['maintenanceStatus']>>;
type Status = NonNullable<Extract<StatusResult, { success: true }>['data']>;
type Phase = (typeof HistoryMaintenancePhase)[keyof typeof HistoryMaintenancePhase];

export function HistoryMaintenanceControls({ api }: { api: MaintenanceApi }) {
  const t = i18nService.t.bind(i18nService);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [phase, setPhase] = useState<Phase>(HistoryMaintenancePhase.Idle);
  const [status, setStatus] = useState<Status | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [statusFailed, setStatusFailed] = useState(false);
  const [statusRevision, setStatusRevision] = useState(0);
  const mounted = useRef(true);
  const busy = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let current = true;
    setStatusFailed(false);
    void api
      .maintenanceStatus()
      .then(result => {
        if (!current) return;
        if (result.success) setStatus(result.data);
        else setStatusFailed(true);
      })
      .catch(() => {
        if (current) setStatusFailed(true);
      });
    return () => {
      current = false;
    };
  }, [api, statusRevision]);

  const select = async (kind: Selection['kind']) => {
    if (busy.current) return;
    busy.current = true;
    setPhase(HistoryMaintenancePhase.Selecting);
    setErrorKey(null);
    try {
      const result = await api.selectMaintenance({ kind });
      if (!mounted.current) return;
      if (result.success) setSelection(result.data);
      else setErrorKey('historyMaintenanceSelectFailed');
    } catch {
      if (mounted.current) setErrorKey('historyMaintenanceSelectFailed');
    } finally {
      busy.current = false;
      if (mounted.current) setPhase(HistoryMaintenancePhase.Idle);
    }
  };
  const confirm = async () => {
    if (!selection || busy.current) return;
    busy.current = true;
    setPhase(HistoryMaintenancePhase.Scheduling);
    setErrorKey(null);
    try {
      const result = await api.confirmMaintenance({ selectionId: selection.selectionId });
      if (!mounted.current) return;
      if (result.success) {
        setPhase(HistoryMaintenancePhase.Restarting);
      } else {
        busy.current = false;
        setPhase(HistoryMaintenancePhase.Idle);
        setErrorKey('historyMaintenanceScheduleFailed');
      }
    } catch {
      // An interrupted IPC call does not establish whether restart was scheduled.
      if (mounted.current) {
        setPhase(HistoryMaintenancePhase.Uncertain);
        setErrorKey('historyMaintenanceUncertain');
      }
    }
  };
  const blocked = phase !== HistoryMaintenancePhase.Idle;
  const dismissible = !blocked || phase === HistoryMaintenancePhase.Uncertain;
  const isRestore = selection?.kind === HistoryMaintenanceKind.Restore;
  const statusKey =
    status?.status === 'completed'
      ? status.kind === HistoryMaintenanceKind.Backup
        ? 'historyBackupCompleted'
        : 'historyRestoreCompleted'
      : status?.status === 'recovered'
        ? 'historyRestoreRecovered'
        : 'historyMaintenanceFailed';

  return (
    <section className="flex min-w-0 flex-col gap-4" aria-label={t('historyMaintenanceTitle')}>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          disabled={blocked}
          onClick={() => void select(HistoryMaintenanceKind.Backup)}
        >
          <Archive className="size-4" />
          {t('historyBackup')}
        </Button>
        <Button
          variant="ghost"
          disabled={blocked}
          onClick={() => void select(HistoryMaintenanceKind.Restore)}
        >
          <RotateCcw className="size-4" />
          {t('historyRestore')}
        </Button>
        {phase === HistoryMaintenancePhase.Selecting && (
          <p role="status" className="text-sm text-muted-foreground">
            {t('historyMaintenanceSelecting')}
          </p>
        )}
      </div>
      {status && (
        <Alert>
          <AlertDescription>
            <p>
              {t('historyLastMaintenanceResult')} {t(statusKey)}
            </p>
            {status.path && <p className="break-all">{status.path}</p>}
            {status.rollbackPath && (
              <p className="break-all">
                {t('historyRollbackLocation')} {status.rollbackPath}
              </p>
            )}
          </AlertDescription>
        </Alert>
      )}
      {statusFailed && (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-sm">
          <span>{t('historyMaintenanceStatusFailed')}</span>
          <Button variant="ghost" onClick={() => setStatusRevision(value => value + 1)}>
            {t('historyRetry')}
          </Button>
        </div>
      )}
      {errorKey && !selection && (
        <Alert>
          <AlertDescription>{t(errorKey)}</AlertDescription>
        </Alert>
      )}
      <Dialog
        open={selection !== null}
        onOpenChange={open => {
          if (!open && dismissible) {
            setSelection(null);
            if (!blocked) setErrorKey(null);
          }
        }}
      >
        <DialogContent className="max-h-dvh overflow-y-auto sm:max-w-lg" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>
              {t(isRestore ? 'historyRestoreConfirmTitle' : 'historyBackupConfirmTitle')}
            </DialogTitle>
            <DialogDescription>{t('historyMaintenanceRestartWarning')}</DialogDescription>
          </DialogHeader>
          <div className="flex min-w-0 flex-col gap-4 text-sm">
            <p className="break-all">{selection?.displayPath}</p>
            {isRestore && <p>{t('historyRestoreReplacementWarning')}</p>}
            <p>{t('historyBackupScope')}</p>
            <p>{t('historyBackupExclusions')}</p>
            <p>{t('historyBackupPrivacy')}</p>
            {errorKey && (
              <Alert>
                <AlertDescription>{t(errorKey)}</AlertDescription>
              </Alert>
            )}
            {(phase === HistoryMaintenancePhase.Scheduling ||
              phase === HistoryMaintenancePhase.Restarting) && (
              <p role="status">
                {t(
                  phase === HistoryMaintenancePhase.Restarting
                    ? 'historyMaintenanceRestarting'
                    : 'historyMaintenanceScheduling',
                )}
              </p>
            )}
          </div>
          <DialogFooter surface={DialogFooterSurface.Seamless}>
            <Button
              variant="ghost"
              disabled={!dismissible}
              onClick={() => {
                setSelection(null);
                if (!blocked) setErrorKey(null);
              }}
            >
              {t(blocked ? 'close' : 'cancel')}
            </Button>
            <Button
              variant={isRestore ? 'destructive' : 'default'}
              disabled={blocked}
              onClick={() => void confirm()}
            >
              {t(isRestore ? 'historyRestoreConfirm' : 'historyBackupConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
