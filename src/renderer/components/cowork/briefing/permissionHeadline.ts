import {
  PermissionDangerLevel,
  detectDangerLevelFromCommand,
} from '../../permission/permissionDanger';
import {
  getToolDisplayName,
  getToolInputSummary,
  normalizeToolName,
  truncatePreview,
} from '../helpers/toolUtils';
import type { CoworkPermissionRequest } from '../../../types/cowork';

export interface BriefingHeadlineTemplate {
  i18nKey: string;
  params: Record<string, string>;
}

const countRmTargets = (command: string): number | null => {
  const match = command.trim().match(/^(?:sudo\s+)?rm\s+(?:-[a-zA-Z]+\s+)*(.+)$/i);
  if (!match) return null;
  const rest = match[1]?.trim();
  if (!rest) return null;
  return rest.split(/\s+/).filter(token => token && !token.startsWith('-')).length;
};

const extractGitPushTarget = (command: string): string | null => {
  const match = command.match(/\bgit\s+push\s+(?:\S+\s+)?(\S+)/i);
  const target = match?.[1]?.trim();
  return target && target !== 'push' ? truncatePreview(target, 48) : null;
};

/** Pure template selection for a pending tool approval row. */
export function buildPermissionBriefingHeadline(
  permission: CoworkPermissionRequest,
): BriefingHeadlineTemplate {
  const tool = normalizeToolName(permission.toolName);
  const input = permission.toolInput ?? {};
  const summary = getToolInputSummary(permission.toolName, input);
  const command = typeof input.command === 'string' ? input.command.trim() : '';

  if (tool === 'bash' || tool === 'exec' || tool === 'shell' || tool === 'powershell') {
    const rmCount = command ? countRmTargets(command) : null;
    if (rmCount !== null && rmCount > 0) {
      if (rmCount >= 2) {
        return {
          i18nKey: 'briefingDecisionRemoveMany',
          params: { count: String(rmCount) },
        };
      }
      return {
        i18nKey: 'briefingDecisionRemoveOne',
        params: { target: truncatePreview(summary ?? command, 72) },
      };
    }
    if (/\bgit\s+push\b/i.test(command)) {
      return {
        i18nKey: 'briefingDecisionGitPush',
        params: { target: extractGitPushTarget(command) ?? truncatePreview(command, 48) },
      };
    }
    if (detectDangerLevelFromCommand(command) !== PermissionDangerLevel.Safe) {
      return {
        i18nKey: 'briefingDecisionRiskyShell',
        params: { command: truncatePreview(summary ?? command, 72) },
      };
    }
    return {
      i18nKey: 'briefingDecisionShell',
      params: {
        command: truncatePreview(summary ?? (command || permission.toolName), 72),
      },
    };
  }

  if (tool === 'write' || tool === 'edit' || tool === 'writefile' || tool === 'editfile') {
    return {
      i18nKey: 'briefingDecisionWrite',
      params: { path: truncatePreview(summary ?? '…', 72) },
    };
  }

  if (tool === 'read' || tool === 'readfile') {
    return {
      i18nKey: 'briefingDecisionRead',
      params: { path: truncatePreview(summary ?? '…', 72) },
    };
  }

  const displayTool = getToolDisplayName(permission.toolName);
  if (summary) {
    return {
      i18nKey: 'briefingDecisionToolDetail',
      params: { tool: displayTool, detail: truncatePreview(summary, 72) },
    };
  }

  return {
    i18nKey: 'briefingDecisionTool',
    params: { tool: displayTool },
  };
}
