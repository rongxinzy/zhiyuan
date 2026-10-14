import { useCallback, useState } from 'react';

import { CoworkCompactFailure } from '../../../shared/cowork/constants';
import { showAppToast } from '../../services/appToast';
import { i18nService } from '../../services/i18n';
import type { SlashCommandMenuItem } from '../common/SlashCommandMenu';
import {
  buildCoworkSlashCommands,
  coworkSlashCommandPrompt,
  coworkSlashCommandQuery,
  filterCoworkSlashCommands,
} from './coworkSlashCommands';

interface UseCoworkSlashMenuOptions {
  value: string;
  disabled: boolean;
  sessionId?: string;
  setValue: (value: string) => void;
  focusEditor: () => void;
}

/**
 * Slash command menu state for the Cowork composer (`/compact`).
 * Mirrors the coding composer: completions while typing, and a dismissal that
 * applies to the exact text on screen so the menu does not bounce back open.
 */
export const useCoworkSlashMenu = ({
  value,
  disabled,
  sessionId,
  setValue,
  focusEditor,
}: UseCoworkSlashMenuOptions) => {
  const [commandSelection, setCommandSelection] = useState<{
    query: string | null;
    name: string;
  }>({ query: null, name: '' });
  const [dismissedPrompt, setDismissedPrompt] = useState<string | null>(null);

  const commands = buildCoworkSlashCommands(
    { compact: !!sessionId },
    { compactDescription: i18nService.t('coworkSlashCommandCompactDescription') },
  );
  const query = coworkSlashCommandQuery(value);
  const matchingCommands = query === null ? [] : filterCoworkSlashCommands(commands, query);
  const selectedCommandName = commandSelection.query === query ? commandSelection.name : '';
  const selectedCommand =
    matchingCommands.find(command => command.name === selectedCommandName) ?? matchingCommands[0];
  const open = !disabled && query !== null && commands.length > 0 && dismissedPrompt !== value;
  const items: SlashCommandMenuItem[] = matchingCommands.map(command => ({
    key: command.name,
    token: `/${command.name}`,
    description: command.description,
  }));
  const activeItemKey = selectedCommand?.name ?? '';
  const activeSelectionPrompt = selectedCommand ? coworkSlashCommandPrompt(selectedCommand) : null;
  const selectMenuChoice = (key: string) => {
    const command = matchingCommands.find(candidate => candidate.name === key);
    if (!command) return;
    const next = coworkSlashCommandPrompt(command);
    setDismissedPrompt(next);
    setValue(next);
    requestAnimationFrame(focusEditor);
  };
  const setMenuSelection = (key: string) => setCommandSelection({ query, name: key });
  const dismiss = useCallback(() => setDismissedPrompt(value), [value]);
  const clearDismissal = useCallback(() => setDismissedPrompt(null), []);

  const runCompact = useCallback(async () => {
    if (!sessionId) return;
    showAppToast(i18nService.t('coworkSlashCompactStarted'));
    try {
      const result = await window.electron.cowork.compactSession(sessionId);
      if (result.success) {
        if (result.queued) {
          showAppToast(i18nService.t('coworkSlashCompactQueued'));
        } else if (result.cancelled) {
          showAppToast(i18nService.t('coworkSlashCompactCancelled'));
        } else {
          showAppToast(i18nService.t('coworkSlashCompactSuccess'), { isSuccess: true });
        }
        return;
      }
      const reasonKeys: Record<CoworkCompactFailure, string> = {
        [CoworkCompactFailure.NoSession]: 'coworkSlashCompactNoSession',
        [CoworkCompactFailure.Busy]: 'coworkSlashCompactBusy',
        [CoworkCompactFailure.NotNeeded]: 'coworkSlashCompactNotNeeded',
        [CoworkCompactFailure.Failed]: 'coworkSlashCompactFailed',
      };
      const reason = result.reason ?? CoworkCompactFailure.Failed;
      showAppToast(i18nService.t(reasonKeys[reason]), {
        isError: reason === CoworkCompactFailure.Failed,
      });
    } catch (error) {
      console.error('[CoworkSlashMenu] compaction request failed:', error);
      showAppToast(i18nService.t('coworkSlashCompactFailed'), { isError: true });
    }
  }, [sessionId]);

  return {
    open,
    items,
    activeItemKey,
    activeSelectionPrompt,
    selectedCommand,
    dismiss,
    clearDismissal,
    setMenuSelection,
    selectMenuChoice,
    runCompact,
  };
};
