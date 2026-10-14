import { Button } from '@shared/components/ui/button';
import type React from 'react';

import { i18nService } from '../../services/i18n';
import { ArtifactPanelAnimatedToggleIcon } from '../icons/ArtifactPanelAnimatedToggleIcon';
import PageHeader from '../PageHeader';
import { CoworkSessionTitleLoadingSkeleton } from './CoworkSessionLoadingState';

interface CoworkSessionLayoutProps {
  title: string;
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
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <PageHeader
        title={isSessionSwitching ? undefined : title}
        leftContent={isSessionSwitching ? <CoworkSessionTitleLoadingSkeleton /> : undefined}
        isSidebarCollapsed={isSidebarCollapsed}
        onToggleSidebar={onToggleSidebar}
        onNewChat={onNewChat}
        updateBadge={updateBadge}
        actions={
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleArtifactPanel}
            aria-label={i18nService.t('artifactPanelToggle')}
            disabled={isSessionSwitching}
          >
            <ArtifactPanelAnimatedToggleIcon open={!isSessionSwitching && isArtifactPanelOpen} />
          </Button>
        }
      />
      {runIndicator}
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
    </div>
  );
}
