import { Alert, AlertDescription, AlertTitle } from '@shared/components/ui/alert';
import { Cpu } from 'lucide-react';

import { i18nService } from '../../../services/i18n';
import { useGpuSnapshot } from '../hooks/useGpuSnapshot';

const formatGiB = (mib: number) => (mib / 1024).toFixed(1);

export function LocalGpuStatus({ active }: { active: boolean }) {
  const { snapshot, loading } = useGpuSnapshot(active);
  const gpus = snapshot?.available ? snapshot.gpus : [];
  const unknown = i18nService.t('localGpuUnknown');

  return (
    <Alert role="region" aria-label={i18nService.t('localGpuStatusTitle')} className="shrink-0">
      <Cpu />
      <AlertTitle>{i18nService.t('localGpuStatusTitle')}</AlertTitle>
      <AlertDescription className="min-w-0">
        {loading ? (
          i18nService.t('localGpuChecking')
        ) : gpus.length === 0 ? (
          i18nService.t('localGpuUnavailable')
        ) : (
          <div className="flex min-w-0 flex-col gap-2">
            {gpus.map(gpu => (
              <div key={gpu.index} className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
                <span className="min-w-0 wrap-break-word">{gpu.name}</span>
                <span>
                  {i18nService.t('localGpuMemoryUsage')}{' '}
                  {gpu.memoryFreeMiB === undefined
                    ? unknown
                    : formatGiB(gpu.memoryTotalMiB - gpu.memoryFreeMiB)}
                  {' / '}
                  {formatGiB(gpu.memoryTotalMiB)} GiB
                </span>
                <span>
                  {i18nService.t('localGpuUtilization')}{' '}
                  {gpu.utilizationPercent === undefined ? unknown : `${gpu.utilizationPercent}%`}
                </span>
              </div>
            ))}
          </div>
        )}
      </AlertDescription>
    </Alert>
  );
}
