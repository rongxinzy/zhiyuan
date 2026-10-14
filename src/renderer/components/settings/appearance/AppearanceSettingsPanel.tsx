import { FluidTabs } from '@shared/components/ui/fluid-tabs';
import { i18nService } from '../../../services/i18n';

type Appearance = 'light' | 'dark' | 'system';
const APPEARANCES = ['light', 'dark', 'system'] as const;

export function AppearanceSettingsPanel({
  appearance,
  onAppearanceChange,
}: {
  appearance: Appearance;
  onAppearanceChange: (appearance: Appearance) => void;
}) {
  return (
    <section className="space-y-3" aria-label={i18nService.t('appearanceMode')}>
      <h4 className="text-base font-semibold">{i18nService.t('appearanceMode')}</h4>
      <FluidTabs<Appearance>
        className="theme-appearance-mode-tabs"
        aria-label={i18nService.t('appearanceMode')}
        value={appearance}
        onValueChange={onAppearanceChange}
        items={APPEARANCES.map(value => ({ value, label: i18nService.t(value) }))}
      />
    </section>
  );
}
