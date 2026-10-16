import { Button } from '@shared/components/ui/button';

import {
  BrowserPreviewBriefingScenarioId,
  browserPreviewBriefingScenarioLabels,
} from './browserPreviewBriefingScenarios';

const previewViews = [
  { id: 'cowork', label: '会话与工作' },
  { id: 'localInference', label: '本地推理' },
  { id: 'skillsMcp', label: '技能与 MCP' },
  { id: 'settings', label: '设置' },
  { id: 'todo', label: '待办' },
  { id: 'scheduledTasks', label: '计划任务' },
  { id: 'activity', label: '活动' },
  { id: 'coding', label: '编程' },
  { id: 'history', label: '历史' },
] as const;

const briefingScenarios = Object.values(BrowserPreviewBriefingScenarioId);

export function BrowserPreviewDevPanel() {
  if (!import.meta.env.VITE_BROWSER_PREVIEW) return null;

  return (
    <div
      className="pointer-events-auto fixed bottom-3 right-3 z-[9999] flex max-w-[min(100vw-1.5rem,22rem)] flex-col gap-2 rounded-xl border border-border bg-surface p-2 shadow-popover"
      data-testid="browser-preview-panel"
    >
      <p className="px-1 text-xs font-medium text-muted-foreground">浏览器预览 · 页面跳转</p>
      <p className="px-1 text-xs font-medium text-muted-foreground">工作简报夹具</p>
      <div className="flex flex-wrap gap-1">
        {briefingScenarios.map(scenarioId => (
          <Button
            key={scenarioId}
            type="button"
            size="sm"
            variant="secondary"
            className="h-8 text-xs"
            onClick={() => {
              window.dispatchEvent(
                new CustomEvent('browser-preview:briefing-scenario', { detail: scenarioId }),
              );
            }}
          >
            {browserPreviewBriefingScenarioLabels[scenarioId]}
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1">
        {previewViews.map(view => (
          <Button
            key={view.id}
            type="button"
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            onClick={() => {
              window.dispatchEvent(
                new CustomEvent('browser-preview:navigate', { detail: view.id }),
              );
            }}
          >
            {view.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
