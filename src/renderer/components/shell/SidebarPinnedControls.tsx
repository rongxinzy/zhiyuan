import { Button } from '@shared/components/ui/button';
import { Puzzle, Settings } from 'lucide-react';

import { i18nService } from '../../services/i18n';
import type { PrefetchableFeatureView } from '../featureViewPrefetch';
import type { SidebarActiveView } from '../SidebarNavigationControls';

interface SidebarPinnedControlsProps {
  activeView: SidebarActiveView;
  onShowSkillsAndMcp: () => void;
  onShowSettings: () => void;
  onPrefetchView?: (view: PrefetchableFeatureView) => void;
}

export function SidebarPinnedControls({
  activeView,
  onShowSkillsAndMcp,
  onShowSettings,
  onPrefetchView,
}: SidebarPinnedControlsProps) {
  const skillsActive = activeView === 'skillsMcp';
  const settingsActive = activeView === 'settings';

  return (
    <div className="flex flex-col gap-1">
      <Button
        type="button"
        variant="navigation"
        size="navigation"
        data-testid="sidebar-skills-and-mcp"
        data-active={skillsActive || undefined}
        aria-current={skillsActive ? 'page' : undefined}
        onClick={onShowSkillsAndMcp}
        onMouseEnter={() => onPrefetchView?.('skillsMcp')}
        onFocus={() => onPrefetchView?.('skillsMcp')}
      >
        <Puzzle aria-hidden="true" className="size-4 shrink-0" strokeWidth={1.75} />
        <span className="min-w-0 truncate">{i18nService.t('sidebarSkillsAndMcp')}</span>
      </Button>
      <Button
        type="button"
        variant="navigation"
        size="navigation"
        data-testid="sidebar-settings"
        data-active={settingsActive || undefined}
        aria-current={settingsActive ? 'page' : undefined}
        onClick={onShowSettings}
        onMouseEnter={() => onPrefetchView?.('settings')}
        onFocus={() => onPrefetchView?.('settings')}
      >
        <Settings aria-hidden="true" className="size-4 shrink-0" strokeWidth={1.75} />
        <span className="min-w-0 truncate">{i18nService.t('settings')}</span>
      </Button>
    </div>
  );
}
