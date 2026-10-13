import { useCallback, useEffect, useRef, useState } from 'react';

import type { CoworkSessionInterruption } from '../../../../shared/cowork/interruption';
import type { WorkbenchTaskResumeInput } from '../../../../shared/workbenchTask';
import { i18nService } from '../../../services/i18n';
import { normalizeError } from '../../../services/errorNormalization';
import { showAppErrorToast } from '../../../services/toastNotification';

export const useTaskResumeContext = (sessionId: string | undefined) => {
  const [interruption, setInterruption] = useState<CoworkSessionInterruption | null>(null);
  const [isResuming, setIsResuming] = useState(false);
  const contextVersion = useRef(0);
  const pendingResume = useRef<symbol | null>(null);
  const activeSession = useRef(sessionId);

  useEffect(() => {
    activeSession.current = sessionId;
    setInterruption(null);
    setIsResuming(false);
    return () => {
      contextVersion.current += 1;
      pendingResume.current = null;
      activeSession.current = undefined;
    };
  }, [sessionId]);

  const select = useCallback(
    (next: CoworkSessionInterruption) => {
      if (
        !next.recoverable ||
        next.sessionId !== sessionId ||
        activeSession.current !== sessionId ||
        !next.taskId
      )
        return;
      contextVersion.current += 1;
      setInterruption(next);
    },
    [sessionId],
  );

  const cancel = useCallback(() => {
    contextVersion.current += 1;
    setInterruption(null);
  }, []);

  const resume = useCallback(
    async (input: Omit<WorkbenchTaskResumeInput, 'taskId'>): Promise<boolean> => {
      const taskId = interruption?.taskId;
      if (
        !taskId ||
        interruption.sessionId !== sessionId ||
        activeSession.current !== sessionId ||
        pendingResume.current
      )
        return false;
      const target = interruption;
      const version = contextVersion.current;
      const request = Symbol();
      // Lock synchronously: repeated submissions can precede React's next render.
      pendingResume.current = request;
      const isCurrent = () =>
        contextVersion.current === version && pendingResume.current === request;
      setIsResuming(true);
      // 2026/09/17 lixiang  开始继续执行时立刻清掉输入框里的暂停任务嵌入
      setInterruption(null);
      try {
        const result = await window.electron.workbenchTask.resume({
          ...input,
          taskId,
        });
        // An older session or selection must not restore its badge, toast, or
        // signal the caller to clear the newly selected conversation's draft.
        if (!isCurrent()) return false;
        if (!result.success) {
          showAppErrorToast(
            normalizeError(result.error || i18nService.t('coworkResumeTaskFailed')),
          );
          // 2026/09/17 lixiang  启动失败时恢复嵌入，方便用户重试
          setInterruption(target);
          return false;
        }
        return true;
      } catch {
        if (!isCurrent()) return false;
        showAppErrorToast(i18nService.t('coworkResumeTaskFailed'));
        setInterruption(target);
        return false;
      } finally {
        if (pendingResume.current === request) {
          pendingResume.current = null;
          setIsResuming(false);
        }
      }
    },
    [interruption, sessionId],
  );

  return { cancel, interruption, isResuming, resume, select };
};
