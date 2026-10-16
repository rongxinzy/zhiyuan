import { ActivityErrorCode, ActivitySource, ActivityStatus } from '../../shared/activity/constants';
import type { ActivityRun } from '../../shared/activity/types';
import { CoworkPermissionOrigin } from '../../shared/cowork/constants';
import type { ScheduledTask } from '../../scheduledTask/types';
import type { CoworkPermissionRequest, CoworkSessionSummary } from '../types/cowork';
import {
  BrowserPreviewFixtureId,
  browserPreviewActivityRuns,
  browserPreviewScheduledTasks,
  browserPreviewSessionSummaries,
} from './browserPreviewFixtures';

export const BrowserPreviewBriefingScenarioId = {
  Full: 'full',
  Empty: 'empty',
  Loading: 'loading',
  LoadFailed: 'load-failed',
} as const;

export type BrowserPreviewBriefingScenarioId =
  (typeof BrowserPreviewBriefingScenarioId)[keyof typeof BrowserPreviewBriefingScenarioId];

export const BROWSER_PREVIEW_BRIEFING_SCENARIO_KEY = 'browser-preview.briefingScenario';

const now = Date.now();
const hoursAgo = (h: number) => now - h * 60 * 60 * 1000;
const minutesFromNow = (m: number) => now + m * 60 * 1000;

export const browserPreviewBriefingPendingPermissions: CoworkPermissionRequest[] = [
  {
    origin: CoworkPermissionOrigin.PiWorkbench,
    sessionId: 'preview-session-ui-review',
    toolName: 'bash',
    toolInput: {
      command: 'rm -rf dist/old-build-1 dist/old-build-2 dist/old-build-3',
    },
    requestId: 'preview-permission-push',
  },
  {
    origin: CoworkPermissionOrigin.PiWorkbench,
    sessionId: BrowserPreviewFixtureId.SessionRoadmap,
    toolName: 'write',
    toolInput: { path: 'docs/release-notes.md' },
    requestId: 'preview-permission-write',
  },
];

const fullActivityRuns: ActivityRun[] = [
  ...browserPreviewActivityRuns,
  {
    id: 'activity-gpu-batch-1',
    source: ActivitySource.ScheduledTask,
    status: ActivityStatus.Completed,
    startedAt: hoursAgo(10),
    updatedAt: hoursAgo(9.5),
    taskName: '本地 GPU 批处理摘要',
    inputPreview: '用本地模型整理昨日合并记录',
    replyPreview: '已汇总 6 条合并与 2 项待跟进，全文见工作记录。',
  },
  {
    id: 'activity-failed-nightly',
    source: ActivitySource.ScheduledTask,
    status: ActivityStatus.Failed,
    startedAt: hoursAgo(7),
    updatedAt: hoursAgo(6.5),
    taskName: '夜间巡检报告',
    inputPreview: '检查依赖漏洞并生成报告',
    errorMessage: '报告上传失败，需人工确认后重试。',
  },
  {
    id: 'activity-interrupted',
    source: ActivitySource.ScheduledTask,
    status: ActivityStatus.Failed,
    startedAt: hoursAgo(3),
    updatedAt: hoursAgo(2.8),
    taskName: '渠道同步',
    errorMessage: ActivityErrorCode.Interrupted,
  },
];

export interface BrowserPreviewBriefingScenarioConfig {
  id: BrowserPreviewBriefingScenarioId;
  sessionSummaries: CoworkSessionSummary[];
  activityRuns: ActivityRun[];
  scheduledTasks: ScheduledTask[];
  pendingPermissions: CoworkPermissionRequest[];
  activityListSuccess: boolean;
  activityListDelayMs: number;
}

export function resolveBrowserPreviewBriefingScenario(
  scenarioId?: string | null,
): BrowserPreviewBriefingScenarioConfig {
  const id = (scenarioId ??
    BrowserPreviewBriefingScenarioId.Full) as BrowserPreviewBriefingScenarioId;

  switch (id) {
    case BrowserPreviewBriefingScenarioId.Empty:
      return {
        id,
        sessionSummaries: [],
        activityRuns: [],
        scheduledTasks: [],
        pendingPermissions: [],
        activityListSuccess: true,
        activityListDelayMs: 0,
      };
    case BrowserPreviewBriefingScenarioId.Loading:
      return {
        id,
        sessionSummaries: browserPreviewSessionSummaries,
        activityRuns: fullActivityRuns,
        scheduledTasks: browserPreviewScheduledTasks,
        pendingPermissions: browserPreviewBriefingPendingPermissions,
        activityListSuccess: true,
        activityListDelayMs: 4_000,
      };
    case BrowserPreviewBriefingScenarioId.LoadFailed:
      return {
        id,
        sessionSummaries: browserPreviewSessionSummaries,
        activityRuns: [],
        scheduledTasks: browserPreviewScheduledTasks,
        pendingPermissions: browserPreviewBriefingPendingPermissions,
        activityListSuccess: false,
        activityListDelayMs: 0,
      };
    case BrowserPreviewBriefingScenarioId.Full:
    default:
      return {
        id: BrowserPreviewBriefingScenarioId.Full,
        sessionSummaries: browserPreviewSessionSummaries,
        activityRuns: fullActivityRuns,
        scheduledTasks: browserPreviewScheduledTasks,
        pendingPermissions: browserPreviewBriefingPendingPermissions,
        activityListSuccess: true,
        activityListDelayMs: 0,
      };
  }
}

export function readBrowserPreviewBriefingScenarioId(): BrowserPreviewBriefingScenarioId {
  try {
    const stored = localStorage.getItem(BROWSER_PREVIEW_BRIEFING_SCENARIO_KEY);
    if (
      stored &&
      Object.values(BrowserPreviewBriefingScenarioId).includes(
        stored as BrowserPreviewBriefingScenarioId,
      )
    ) {
      return stored as BrowserPreviewBriefingScenarioId;
    }
  } catch {
    // Ignore storage errors in preview.
  }
  return BrowserPreviewBriefingScenarioId.Full;
}

export function writeBrowserPreviewBriefingScenarioId(
  scenarioId: BrowserPreviewBriefingScenarioId,
): void {
  localStorage.setItem(BROWSER_PREVIEW_BRIEFING_SCENARIO_KEY, scenarioId);
}

/** Mutable preview IPC state; scenarios update this before refresh. */
export const browserPreviewBriefingRuntime = {
  config: resolveBrowserPreviewBriefingScenario(readBrowserPreviewBriefingScenarioId()),
};

export function applyBrowserPreviewBriefingScenario(
  scenarioId: BrowserPreviewBriefingScenarioId,
): BrowserPreviewBriefingScenarioConfig {
  writeBrowserPreviewBriefingScenarioId(scenarioId);
  browserPreviewBriefingRuntime.config = resolveBrowserPreviewBriefingScenario(scenarioId);
  return browserPreviewBriefingRuntime.config;
}

export const browserPreviewBriefingScenarioLabels: Record<
  BrowserPreviewBriefingScenarioId,
  string
> = {
  [BrowserPreviewBriefingScenarioId.Full]: '简报 · 三栏齐全',
  [BrowserPreviewBriefingScenarioId.Empty]: '简报 · 新用户空态',
  [BrowserPreviewBriefingScenarioId.Loading]: '简报 · 加载中',
  [BrowserPreviewBriefingScenarioId.LoadFailed]: '简报 · 读取失败',
};

/** Ensures scheduled tasks always include a near-future run for the next column. */
export function withStableUpcomingSchedule(tasks: ScheduledTask[]): ScheduledTask[] {
  if (tasks.length === 0) return tasks;
  return tasks.map((task, index) =>
    index === 0
      ? {
          ...task,
          state: {
            ...task.state,
            nextRunAtMs: minutesFromNow(90),
          },
        }
      : task,
  );
}
