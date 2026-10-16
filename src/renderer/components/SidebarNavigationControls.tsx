import { i18nService } from '../services/i18n';
import { workspaceService } from '../services/workspace';
import { shouldShowLocalInferenceNavigation } from '../services/managedModelUiPolicy';
import { WorkMode } from '../store/workMode/constants';
import type { PrefetchableFeatureView } from './featureViewPrefetch';
import { SidebarNavigationView, type SidebarNavigationEntry } from './shell/SidebarNavigationView';

export type SidebarActiveView =
  | 'cowork'
  | 'settings'
  | 'skillsMcp'
  | 'scheduledTasks'
  | 'activity'
  | 'localInference'
  | 'expert'
  | 'coding'
  | 'todo'
  | 'history';

interface SidebarNavigationControlsProps {
  activeView: SidebarActiveView;
  onNewChat: () => void;
  onShowLocalInference: () => void;
  onWorkModeChange: (checked: boolean) => void;
  workMode: WorkMode;
  managedModelsOnly?: boolean;
  /** Warms the lazily loaded chunk for a view on hover/focus intent. */
  onPrefetchView?: (view: PrefetchableFeatureView) => void;
}

const WORK_SURFACE_VIEWS = new Set<SidebarActiveView>([
  'cowork',
  'coding',
  'todo',
  'scheduledTasks',
  'activity',
  'history',
]);

export const SidebarNavigationControls = ({
  activeView,
  onNewChat,
  onShowLocalInference,
  onWorkModeChange,
  workMode,
  managedModelsOnly = false,
  onPrefetchView,
}: SidebarNavigationControlsProps) => {
  const isChat = workMode === WorkMode.Chat;
  const handleNewConversation = () => {
    if (workMode === WorkMode.Work) void workspaceService.clearWorkspaceSelection();
    onNewChat();
  };
  const entries: SidebarNavigationEntry[] = [];
  if (shouldShowLocalInferenceNavigation(isChat, managedModelsOnly)) {
    entries.push({
      id: 'localInference',
      icon: 'localInference',
      label: i18nService.t('localInferenceTitle'),
      onClick: onShowLocalInference,
      active: activeView === 'localInference',
      currentPage: activeView === 'localInference',
      onIntent: () => onPrefetchView?.('localInference'),
    });
  }
  const onWorkSurface = WORK_SURFACE_VIEWS.has(activeView);
  return (
    <SidebarNavigationView
      isChat={isChat}
      sessionsAndWorkLabel={i18nService.t('sidebarSessionsAndWork')}
      workLabel={i18nService.t('workMode')}
      chatLabel={i18nService.t('chatMode')}
      onModeChange={onWorkModeChange}
      newConversation={{
        id: 'conversation',
        icon: 'conversation',
        label: i18nService.t(isChat ? 'newChat' : 'newTask'),
        active: onWorkSurface,
        currentPage: activeView === 'cowork',
        onClick: handleNewConversation,
        testId: 'sidebar-new-conversation',
      }}
      entries={entries}
    />
  );
};
