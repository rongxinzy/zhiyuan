import type {
  CodingAgentAvailableCommand,
  CodingAgentAvailableCommandOption,
} from '../../../shared/codingAgent';
import { t } from '../../i18n';

/** Slash commands the built-in coding agent parses out of a prompt itself. */
export const BuiltinCodingCommand = {
  Expert: 'expert',
} as const;
export type BuiltinCodingCommand = (typeof BuiltinCodingCommand)[keyof typeof BuiltinCodingCommand];

/**
 * Slash commands the built-in coding agent runs as local control actions.
 * They never reach the model, so they carry no argument and no prompt text.
 */
export const BuiltinCodingControlCommand = {
  Compact: 'compact',
  Status: 'status',
} as const;
export type BuiltinCodingControlCommand =
  (typeof BuiltinCodingControlCommand)[keyof typeof BuiltinCodingControlCommand];

/**
 * Argument that clears the expert selected for the live session. An
 * installed entry with this exact id takes precedence over clearing.
 */
export const BuiltinCodingSelectionOff = 'off';

/** One installed expert offered after its command. */
export interface BuiltinCodingCommandChoice {
  id: string;
  name: string;
  description: string;
}

/** Everything the command menu can offer beyond the fixed commands. */
export interface BuiltinCodingCommandChoices {
  experts: BuiltinCodingCommandChoice[];
}

export const EMPTY_BUILTIN_CODING_COMMAND_CHOICES: BuiltinCodingCommandChoices = {
  experts: [],
};

const buildChoiceOptions = (
  choices: BuiltinCodingCommandChoice[],
): CodingAgentAvailableCommandOption[] =>
  choices.map(choice => ({
    value: choice.id,
    label: choice.name || choice.id,
    ...(choice.description ? { description: choice.description } : {}),
  }));

const buildSelectionOptions = (
  choices: BuiltinCodingCommandChoice[],
  offLabel: string,
): CodingAgentAvailableCommandOption[] => [
  ...buildChoiceOptions(choices),
  // Clearing stays last so an empty query keeps the first selectable entry. An
  // installed entry that already owns the reserved argument drops it: two rows
  // with the same value would render as duplicates and both select the same id.
  ...(choices.some(choice => choice.id === BuiltinCodingSelectionOff)
    ? []
    : [{ value: BuiltinCodingSelectionOff, label: offLabel }]),
];

/** A bare `/name` with no arguments at all. */
const CONTROL_COMMAND_PATTERN = /^\/([a-z][a-z0-9-]*)$/u;

/** `/expert <id>`, with the turn body after the selection. */
const SELECTION_COMMAND_PATTERN = /^\/([a-z][a-z0-9-]*)\s+(\S+)(?:\s+([\s\S]*))?$/u;

const selectionKind = (name: string): ParsedBuiltinCodingSelection['kind'] | null => {
  if (name === BuiltinCodingCommand.Expert) return 'expert';
  return null;
};

/** Advertised once per session so the composer can offer the command menu. */
export const buildBuiltinCodingCommandList = (
  choices: BuiltinCodingCommandChoices = EMPTY_BUILTIN_CODING_COMMAND_CHOICES,
): CodingAgentAvailableCommand[] => [
  ...(choices.experts.length > 0
    ? [
        {
          name: BuiltinCodingCommand.Expert,
          description: t('codingAgentCommandExpertDescription'),
          input: {
            hint: t('codingAgentCommandExpertHint'),
            options: buildSelectionOptions(choices.experts, t('codingAgentCommandExpertNone')),
          },
        },
      ]
    : []),
  {
    name: BuiltinCodingControlCommand.Compact,
    description: t('codingAgentCommandCompact'),
  },
  {
    name: BuiltinCodingControlCommand.Status,
    description: t('codingAgentCommandStatus'),
  },
];

export interface ParsedBuiltinCodingControlCommand {
  command: BuiltinCodingControlCommand;
}

/**
 * A control command is only recognized when it is the whole prompt: `/compact`
 * runs the compaction, `/compact the login module` stays a normal model prompt.
 */
export const parseBuiltinCodingControlCommand = (
  raw: string,
): ParsedBuiltinCodingControlCommand | null => {
  const trimmed = raw.trim();
  const match = CONTROL_COMMAND_PATTERN.exec(trimmed);
  if (!match) return null;
  return (Object.values(BuiltinCodingControlCommand) as string[]).includes(match[1])
    ? { command: match[1] as BuiltinCodingControlCommand }
    : null;
};

export interface ParsedBuiltinCodingSelection {
  kind: 'expert';
  /** Selected id, or null when the command clears the current selection. */
  id: string | null;
}

export interface ParsedBuiltinCodingPrompt {
  /** Prompt text forwarded to the in-process runtime. */
  prompt: string;
  /** Present only when the prompt selects or clears an expert. */
  selection?: ParsedBuiltinCodingSelection;
}

/**
 * `/expert <id> <task>` selects an expert for
 * the live session, and `off` clears the selection. A bare command or an id
 * that is not installed is passed through untouched, exactly like any other
 * unknown slash command, so a typo never silently changes the session.
 */
const parseSelectionCommand = (
  raw: string,
  choices: BuiltinCodingCommandChoices,
): ParsedBuiltinCodingPrompt | null => {
  const match = SELECTION_COMMAND_PATTERN.exec(raw.trim());
  if (!match) return null;
  const kind = selectionKind(match[1]);
  if (!kind) return null;
  const body = (match[3] ?? '').trim();
  if (!body) return null;
  const value = match[2];
  const installed = choices.experts;
  const selected = installed.find(choice => choice.id === value);
  if (selected) {
    return { prompt: body, selection: { kind, id: selected.id } };
  }
  if (value === BuiltinCodingSelectionOff) {
    return { prompt: body, selection: { kind, id: null } };
  }
  return null;
};

/** Unknown commands stay ordinary prompt text. */
export const parseBuiltinCodingPrompt = (
  raw: string,
  choices: BuiltinCodingCommandChoices = EMPTY_BUILTIN_CODING_COMMAND_CHOICES,
): ParsedBuiltinCodingPrompt => parseSelectionCommand(raw, choices) ?? { prompt: raw };
