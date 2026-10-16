import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@shared/components/ui/empty';
import { Puzzle } from 'lucide-react';

import { i18nService } from '../../services/i18n';
import PageHeader from '../PageHeader';

interface SkillsAndMcpViewProps {
  isSidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  onNewChat?: () => void;
}

export default function SkillsAndMcpView({
  isSidebarCollapsed,
  onToggleSidebar,
  onNewChat,
}: SkillsAndMcpViewProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={i18nService.t('sidebarSkillsAndMcp')}
        isSidebarCollapsed={isSidebarCollapsed}
        onToggleSidebar={onToggleSidebar}
        onNewChat={onNewChat}
      />
      <div className="flex flex-1 items-center justify-center p-6">
        <Empty className="max-w-md">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Puzzle className="size-8 text-muted-foreground" aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>{i18nService.t('sidebarSkillsAndMcpEmptyTitle')}</EmptyTitle>
            <EmptyDescription>
              {i18nService.t('sidebarSkillsAndMcpEmptyDescription')}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    </div>
  );
}
