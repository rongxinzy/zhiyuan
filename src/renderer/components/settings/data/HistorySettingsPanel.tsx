import type { HistoryApi } from '@shared/history';
import { i18nService } from '../../../services/i18n';
import { HistoryMaintenanceControls } from '../../history/HistoryMaintenanceControls';

export function HistorySettingsPanel({ api }: { api: HistoryApi }) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <p className="theme-home-caption">{i18nService.t('historySettingsHint')}</p>
      <HistoryMaintenanceControls api={api} />
    </div>
  );
}
