import { Tabs } from '@shared/components/ui/tabs';
import { PageTabs } from '@shared/components/ui/page-tabs';
import type { WorkSceneSection } from './scene/WorkSceneResults';
import { Button } from '@shared/components/ui/button';
import type React from 'react';

import { i18nService } from '../../services/i18n';
import { ArtifactPanelAnimatedToggleIcon } from '../icons/ArtifactPanelAnimatedToggleIcon';
import PageHeader from '../PageHeader';
import { CoworkSessionTitleLoadingSkeleton } from './CoworkSessionLoadingState';

interface CoworkSessionLayoutProps {
  title: string;
  section?: WorkSceneSection;
  onSectionChange?: (section: WorkSceneSection) => void;
  isSessionSwitching: boolean;
  isSidebarCollapsed?: boolean;
  isArtifactPanelOpen: boolean;
  onToggleSidebar?: () => void;
  onNewChat?: () => void;
  onToggleArtifactPanel: () => void;
  updateBadge?: React.ReactNode;
  runIndicator?: React.ReactNode;
  children: React.ReactNode;
}

export function CoworkSessionLayout({
  title,
  section,
  onSectionChange,
  isSessionSwitching,
  isSidebarCollapsed,
  isArtifactPanelOpen,
  onToggleSidebar,
  onNewChat,
  onToggleArtifactPanel,
  updateBadge,
  runIndicator,
  children,
}: CoworkSessionLayoutProps) {
  return (
    <Tabs
      value={section ?? 'conversation'}
      onValueChange={value => onSectionChange?.(value as WorkSceneSection)}
      className="flex h-full min-h-0 flex-1 flex-col gap-0 overflow-hidden bg-background"
    >
      <PageHeader
        tabs={
          section ? (
            <div className="overflow-x-auto">
              <PageTabs
                bare
                value={section}
                items={[
                  {
                    value: 'results',
                    label: i18nService.t('workSceneResults'),
                    disabled: isSessionSwitching,
                  },
                  {
                    value: 'conversation',
                    label: i18nService.t('workSceneConversation'),
                    disabled: isSessionSwitching,
                  },
                  {
                    value: 'document',
                    label: i18nService.t('workSceneDocument'),
                    disabled: isSessionSwitching,
                  },
                ]}
              />
            </div>
          ) : undefined
        }
        title={isSessionSwitching ? undefined : title}
        leftContent={isSessionSwitching ? <CoworkSessionTitleLoadingSkeleton /> : undefined}
        isSidebarCollapsed={isSidebarCollapsed}
        onToggleSidebar={onToggleSidebar}
        onNewChat={onNewChat}
        updateBadge={updateBadge}
        actions={
          <Button
            variant="ghost"
            size={section ? 'sm' : 'icon'}
            onClick={onToggleArtifactPanel}
            aria-label={i18nService.t('artifactPanelToggle')}
            disabled={isSessionSwitching}
          >
            <ArtifactPanelAnimatedToggleIcon open={!isSessionSwitching && isArtifactPanelOpen} />
            {section && <span>{i18nService.t('workScenePreview')}</span>}
          </Button>
        }
      />
      {runIndicator}
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
    </Tabs>
  );
}
