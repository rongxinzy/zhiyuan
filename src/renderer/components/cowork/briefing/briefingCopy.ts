import { i18nService } from '../../../services/i18n';

/** Replace `{name}` placeholders using the active locale string. */
export function formatBriefingTemplate(key: string, params: Record<string, string> = {}): string {
  const template = i18nService.t(key);
  return template.replace(/\{(\w+)\}/g, (_, name: string) => params[name] ?? '');
}
