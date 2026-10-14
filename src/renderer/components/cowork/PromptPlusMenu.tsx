import { PromptInputButton } from '@shared/components/ai-elements/prompt-input';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@shared/components/ui/dropdown-menu';
import { Plus } from 'lucide-react';
import React, { useCallback, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';

import { CoworkSessionExpertSource } from '../../../shared/cowork/sessionExperts';
import { i18nService } from '../../services/i18n';
import { RootState } from '../../store';
import { ExpertAvatar } from '../expert/expertAvatars';
import { PlusMenuExpertGlyphIcon, PlusMenuExpertsIcon, PlusMenuFilesIcon } from './plusMenuIcons';

interface PromptPlusMenuExpertsProps {
  selectedExpertIds: string[];
  onChange: (expertIds: string[]) => void;
}

interface PromptPlusMenuProps {
  /** Opens the native file picker for attachments */
  onAddFile: () => void;
  /** Work mode only: session expert multi-select shown as a 专家 submenu */
  experts?: PromptPlusMenuExpertsProps;
  disabled?: boolean;
}

const PromptPlusMenu: React.FC<PromptPlusMenuProps> = ({
  onAddFile,
  experts,
  disabled = false,
}) => {
  const [open, setOpen] = useState(false);
  const agents = useSelector((state: RootState) => state.agent.agents);
  const currentSession = useSelector((state: RootState) => state.cowork.currentSession);

  const availableExperts = useMemo(
    () =>
      agents.filter(
        agent =>
          agent.enabled &&
          (agent.source === CoworkSessionExpertSource.Package ||
            agent.source === CoworkSessionExpertSource.Member),
      ),
    [agents],
  );
  const expertSnapshotNames = useMemo(
    () =>
      new Map((currentSession?.experts ?? []).map(expert => [expert.expertId, expert.expertName])),
    [currentSession?.experts],
  );

  const handleToggleExpert = useCallback(
    (expertId: string) => {
      if (!experts) return;
      const next = experts.selectedExpertIds.includes(expertId)
        ? experts.selectedExpertIds.filter(id => id !== expertId)
        : [expertId];
      experts.onChange(next);
    },
    [experts],
  );

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        nativeButton={true}
        disabled={disabled}
        render={
          <PromptInputButton
            disabled={disabled}
            className="sidebar-interactive-surface theme-prompt-raised-action"
            aria-label={i18nService.t('filesAndImages')}
          >
            <Plus className="h-4 w-4" />
          </PromptInputButton>
        }
      />
      <DropdownMenuContent side="bottom" align="start" sideOffset={4} className="w-56">
        <DropdownMenuItem
          onClick={() => {
            onAddFile();
          }}
        >
          <PlusMenuFilesIcon className="size-4" />
          <span className="truncate">{i18nService.t('filesAndImages')}</span>
        </DropdownMenuItem>

        {experts && (availableExperts.length > 0 || experts.selectedExpertIds.length > 0) && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <PlusMenuExpertsIcon className="size-4" />
              <span className="truncate">{i18nService.t('sessionExperts')}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent align="center" className="w-56">
              {availableExperts.map(expert => (
                <DropdownMenuCheckboxItem
                  key={expert.id}
                  checked={experts.selectedExpertIds.includes(expert.id)}
                  closeOnClick={false}
                  onCheckedChange={() => handleToggleExpert(expert.id)}
                >
                  <ExpertAvatar
                    name={expert.presetId}
                    label={expert.name}
                    className="size-4 rounded-sm border-0"
                  />
                  <span className="truncate">{expert.name}</span>
                </DropdownMenuCheckboxItem>
              ))}
              {experts.selectedExpertIds
                .filter(expertId => !availableExperts.some(expert => expert.id === expertId))
                .map(expertId => (
                  <DropdownMenuCheckboxItem
                    key={expertId}
                    checked
                    closeOnClick={false}
                    onCheckedChange={() => handleToggleExpert(expertId)}
                  >
                    <PlusMenuExpertGlyphIcon className="size-4" />
                    <span className="truncate">
                      {expertSnapshotNames.get(expertId) ?? expertId}
                    </span>
                  </DropdownMenuCheckboxItem>
                ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default PromptPlusMenu;
