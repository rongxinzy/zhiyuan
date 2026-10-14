/**
 * Slash commands for the Cowork (Work/Chat) composer. Mirrors the coding
 * workbench semantics: the menu offers completions while typing, and a
 * control command only counts when it is the whole input — anything else
 * passes through to the model untouched.
 */

export const CoworkSlashCommand = {
  Compact: 'compact',
} as const;
export type CoworkSlashCommand = (typeof CoworkSlashCommand)[keyof typeof CoworkSlashCommand];

/** One fixed command offered by the composer's command menu. */
export interface CoworkSlashCommandItem {
  name: string;
  description: string;
  hint?: string;
}

const SLASH_COMMAND_QUERY_PATTERN = /^\/([^\s]*)$/u;
const CONTROL_COMMAND_PATTERN = /^\/([a-z][a-z0-9-]*)$/u;

/** The command menu opens while the whole input is a leading slash token. */
export const coworkSlashCommandQuery = (prompt: string): string | null => {
  const match = SLASH_COMMAND_QUERY_PATTERN.exec(prompt);
  return match ? match[1] : null;
};

/** Commands matching the query, name matches before description matches. */
export const filterCoworkSlashCommands = (
  commands: CoworkSlashCommandItem[],
  query: string,
): CoworkSlashCommandItem[] => {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return commands;
  return commands
    .map((command, index) => {
      const name = command.name.toLocaleLowerCase();
      const description = command.description.toLocaleLowerCase();
      const relevance = name.startsWith(normalizedQuery)
        ? 0
        : name.includes(normalizedQuery)
          ? 1
          : description.includes(normalizedQuery)
            ? 2
            : null;
      return { command, index, relevance };
    })
    .filter(
      (candidate): candidate is typeof candidate & { relevance: number } =>
        candidate.relevance !== null,
    )
    .sort((left, right) => left.relevance - right.relevance || left.index - right.index)
    .map(candidate => candidate.command);
};

/** Text inserted when a command is chosen; a hint means an argument follows. */
export const coworkSlashCommandPrompt = (command: CoworkSlashCommandItem): string =>
  `/${command.name}${command.hint ? ' ' : ''}`;

export const buildCoworkSlashCommands = (
  availability: { compact: boolean },
  text: { compactDescription: string },
): CoworkSlashCommandItem[] =>
  availability.compact
    ? [{ name: CoworkSlashCommand.Compact, description: text.compactDescription }]
    : [];

export type ParsedCoworkSlashSubmission = { kind: 'compact' } | { kind: 'prompt'; prompt: string };

export interface CoworkSlashParseContext {
  compactAvailable: boolean;
}

/** Only the explicit whole-input control command is intercepted. */
export const parseCoworkSlashSubmission = (
  raw: string,
  context: CoworkSlashParseContext,
): ParsedCoworkSlashSubmission => {
  const control = CONTROL_COMMAND_PATTERN.exec(raw.trim());
  if (control && control[1] === CoworkSlashCommand.Compact && context.compactAvailable) {
    return { kind: 'compact' };
  }
  return { kind: 'prompt', prompt: raw };
};
