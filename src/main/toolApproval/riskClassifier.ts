import { ToolRiskLevel } from '../../shared/cowork/approval';

const readOnlyTools = new Set(['read', 'grep', 'find', 'ls']);
const reversibleTools = new Set(['write', 'edit']);
const irreversibleShellPattern =
  /(?:\brm\b|\brmdir\b|\bdel\b|\bremove-item\b|\bformat\b|\bshutdown\b|\bgit\s+push\b|\bgit\s+reset\s+--hard\b|\bdrop\s+(?:table|database)\b)/i;
// Read-only shell commands, validated segment by segment instead of with one
// permissive pattern: a pattern that allows arbitrary arguments also allows
// `sort -o out.txt` or `find . -fprint out.txt`, which write files while looking
// read-only (a ReadOnly classification bypasses the per-tool approval prompt).
const unsafeShellSegmentPattern = /[;&<>`$()\r\n]/;
const readOnlyCdPrefixPattern =
  /^cd\s+(?:"[^"$`;&|<>()\r\n]+"|'[^'$`;&|<>()\r\n]+'|[-\w./~:@\\]+)\s*&&/;
const READ_ONLY_SHELL_COMMANDS: Record<string, RegExp> = {
  pwd: /^pwd$/,
  ls: /^ls(?:\s+[-\w./~:@\\'"]+)*$/,
  find: /^find\s+[-\w./~:@\\'"]+(?:\s+(?:-(?:maxdepth|mindepth|name|iname|path|ipath|size|mtime|mmin|user|group)\s+[-\w.*?/\\'"]+|-type\s+[bcdpfls]))*$/,
  grep: /^grep(?:\s+[-\w./~:@\\'"*?^[\]|]+)*$/,
  rg: /^rg(?:\s+[-\w./~:@\\'"*?^[\]|]+)*$/,
  node: /^node\s+--version$/,
  python: /^python(?:3)?\s+--version$/,
};
/** Pipes are allowed only into filters that cannot write to disk. A position
 * cannot start with `-`, otherwise `sort -o out.txt` would pass as a path. */
const READ_ONLY_SHELL_FILTERS: Record<string, RegExp> = {
  head: /^head(?:\s+(?:-n\s+\d+|-\d+))?(?:\s+[^\s-][-\w./~:@\\'"]*)*$/,
  tail: /^tail(?:\s+(?:-n\s+\d+|-\d+))?(?:\s+[^\s-][-\w./~:@\\'"]*)*$/,
  wc: /^wc(?:\s+-[lmwc])?(?:\s+[^\s-][-\w./~:@\\'"]*)*$/,
  sort: /^sort(?:\s+(?:-u|-r|-n|-f|-k\s*\d+(?:,\d+)?))*(?:\s+[^\s-][-\w./~:@\\'"]*)*$/,
  uniq: /^uniq(?:\s+(?:-c|-d|-u))*(?:\s+[^\s-][-\w./~:@\\'"]*)*$/,
  cat: /^cat(?:\s+[^\s-][-\w./~:@\\'"]*)*$/,
  nl: /^nl(?:\s+[^\s-][-\w./~:@\\'"]*)*$/,
};
/**
 * Every segment of a pipeline must be read-only, including the first one
 * (`head -n 5 a.txt | tail -1` is a legitimate look-around too). Argument
 * patterns, not the segment position, are what keep writes out: `sort -o`,
 * `find -fprint/-exec/-delete` and any redirection are rejected above.
 */
const READ_ONLY_SHELL_SEGMENTS: Record<string, RegExp> = {
  ...READ_ONLY_SHELL_COMMANDS,
  ...READ_ONLY_SHELL_FILTERS,
};

export function classifyToolRisk(toolName: string, input: Record<string, unknown>): ToolRiskLevel {
  const normalizedName = toolName.trim().toLowerCase();
  if (readOnlyTools.has(normalizedName)) {
    return ToolRiskLevel.ReadOnly;
  }
  if (reversibleTools.has(normalizedName)) return ToolRiskLevel.Reversible;
  // PowerShell has different aliases, providers, argument evaluation, and pipelines.
  // Never reuse the Bash read-only allowlist: unknown commands require approval.
  if (normalizedName === 'powershell') return ToolRiskLevel.Unknown;
  if (normalizedName === 'bash' || normalizedName === 'shell') {
    const command = typeof input.command === 'string' ? input.command : JSON.stringify(input);
    if (isSafeShellCommand(command)) return ToolRiskLevel.ReadOnly;
    return irreversibleShellPattern.test(command)
      ? ToolRiskLevel.Irreversible
      : ToolRiskLevel.Unknown;
  }
  return ToolRiskLevel.Unknown;
}

export function isSafeShellCommand(command: string): boolean {
  const trimmed = command.trim();
  if (!trimmed || irreversibleShellPattern.test(trimmed)) return false;
  const body = trimmed.replace(readOnlyCdPrefixPattern, '').trim();
  if (!body) return false;
  const segments = body.split('|').map(segment => segment.trim());
  if (segments.some(segment => !segment || unsafeShellSegmentPattern.test(segment))) return false;
  return segments.every(segment => isReadOnlyShellSegment(segment, READ_ONLY_SHELL_SEGMENTS));
}

function isReadOnlyShellSegment(segment: string, allowed: Record<string, RegExp>): boolean {
  const name = segment.split(/\s+/)[0];
  const pattern = allowed[name];
  return pattern !== undefined && pattern.test(segment);
}
