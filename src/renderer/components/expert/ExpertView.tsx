import React from 'react';
import { useSelector } from 'react-redux';
import { Button } from '@shared/components/ui/button';
import { Empty, EmptyDescription } from '@shared/components/ui/empty';

import { i18nService } from '../../services/i18n';
import type { RootState } from '../../store';
import PageHeader from '../PageHeader';

interface ExpertViewProps {
  isSidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  onNewChat?: () => void;
  updateBadge?: React.ReactNode;
  onChatWithExpert?: (agentId: string) => void;
}

const ExpertView: React.FC<ExpertViewProps> = ({
  isSidebarCollapsed,
  onToggleSidebar,
  onNewChat,
  updateBadge,
  onChatWithExpert,
}) => {
  const agents = useSelector((state: RootState) => state.agent.agents);
  const available = agents.filter(agent => !agent.isDefault && agent.enabled);
  return (
    <div data-page-canvas className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={i18nService.t('expert')}
        isSidebarCollapsed={isSidebarCollapsed}
        onToggleSidebar={onToggleSidebar}
        onNewChat={onNewChat}
        updateBadge={updateBadge}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-3 px-4 pt-4 pb-8 sm:px-6">
          <p className="theme-home-caption">{i18nService.t('expertsDescription')}</p>
          {available.length === 0 ? (
            <Empty>
              <EmptyDescription>{i18nService.t('expertsEmpty')}</EmptyDescription>
            </Empty>
          ) : (
            <ul className="flex flex-col gap-3">
              {available.map(agent => (
                <li key={agent.id} className="flex min-w-0 items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="theme-card-title truncate">{agent.name}</p>
                    <p className="theme-home-caption break-words">{agent.description}</p>
                  </div>
                  <Button
                    variant="outline"
                    disabled={!onChatWithExpert}
                    onClick={() => onChatWithExpert?.(agent.id)}
                  >
                    {i18nService.t('expertGoToConversation')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};

export default ExpertView;
