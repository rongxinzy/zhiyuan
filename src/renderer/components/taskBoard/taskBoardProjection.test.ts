import { expect, test } from 'vitest';

import {
  BrowserPreviewBriefingScenarioId,
  resolveBrowserPreviewBriefingScenario,
} from '../../browser-preview/browserPreviewBriefingScenarios';
import { TaskBoardColumnId } from './constants';
import { buildTaskBoardColumns } from './taskBoardProjection';

test('full preview fixtures populate all kanban columns', () => {
  const scenario = resolveBrowserPreviewBriefingScenario(BrowserPreviewBriefingScenarioId.Full);
  const columns = buildTaskBoardColumns({
    sessions: scenario.sessionSummaries,
    permissions: scenario.pendingPermissions,
    activities: scenario.activityRuns,
    schedules: scenario.scheduledTasks,
    now: Date.now(),
  });

  expect(columns[TaskBoardColumnId.AwaitingConfirm].length).toBeGreaterThan(0);
  expect(columns[TaskBoardColumnId.InProgress].length).toBeGreaterThan(0);
  expect(columns[TaskBoardColumnId.Completed].length).toBeGreaterThan(0);
  expect(columns[TaskBoardColumnId.Pending].length).toBeGreaterThan(0);
});

test('empty preview scenario yields empty board columns', () => {
  const scenario = resolveBrowserPreviewBriefingScenario(BrowserPreviewBriefingScenarioId.Empty);
  const columns = buildTaskBoardColumns({
    sessions: scenario.sessionSummaries,
    permissions: scenario.pendingPermissions,
    activities: scenario.activityRuns,
    schedules: scenario.scheduledTasks,
    now: Date.now(),
  });

  for (const columnId of Object.values(TaskBoardColumnId)) {
    expect(columns[columnId]).toEqual([]);
  }
});
