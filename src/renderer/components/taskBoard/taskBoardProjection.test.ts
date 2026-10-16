import { expect, test } from 'vitest';

import {
  BrowserPreviewBriefingScenarioId,
  resolveBrowserPreviewBriefingScenario,
} from '../../browser-preview/browserPreviewBriefingScenarios';
import { browserPreviewWorkspaces } from '../../browser-preview/browserPreviewFixtures';
import { TaskBoardColumnId } from './constants';
import { buildTaskBoardColumns } from './taskBoardProjection';

test('full preview fixtures populate all kanban columns', () => {
  const scenario = resolveBrowserPreviewBriefingScenario(BrowserPreviewBriefingScenarioId.Full);
  const columns = buildTaskBoardColumns({
    sessions: scenario.sessionSummaries,
    permissions: scenario.pendingPermissions,
    activities: scenario.activityRuns,
    schedules: scenario.scheduledTasks,
    workspaces: browserPreviewWorkspaces,
    now: Date.now(),
  });

  expect(columns[TaskBoardColumnId.AwaitingConfirm].length).toBeGreaterThan(0);
  expect(columns[TaskBoardColumnId.InProgress].length).toBeGreaterThan(0);
  expect(columns[TaskBoardColumnId.NeedsAttention].length).toBeGreaterThan(0);
  expect(columns[TaskBoardColumnId.Completed].length).toBeGreaterThan(0);
  expect(columns[TaskBoardColumnId.Pending].length).toBeGreaterThan(0);

  const pendingTitles = columns[TaskBoardColumnId.Pending].map(card => card.title);
  expect(pendingTitles).not.toContain('渠道同步');
  expect(pendingTitles).not.toContain('夜间巡检报告');
  const attentionTitles = columns[TaskBoardColumnId.NeedsAttention].map(card => card.title);
  expect(attentionTitles).toContain('渠道同步');
  expect(attentionTitles).toContain('夜间巡检报告');
});

test('empty preview scenario yields empty board columns', () => {
  const scenario = resolveBrowserPreviewBriefingScenario(BrowserPreviewBriefingScenarioId.Empty);
  const columns = buildTaskBoardColumns({
    sessions: scenario.sessionSummaries,
    permissions: scenario.pendingPermissions,
    activities: scenario.activityRuns,
    schedules: scenario.scheduledTasks,
    workspaces: browserPreviewWorkspaces,
    now: Date.now(),
  });

  for (const columnId of Object.values(TaskBoardColumnId)) {
    expect(columns[columnId]).toEqual([]);
  }
});
