import { expect, test } from 'vitest';

import { buildWorkBriefing } from '../components/cowork/briefing/projection';
import { BriefingTarget } from '../components/cowork/briefing/constants';
import {
  BrowserPreviewBriefingScenarioId,
  browserPreviewBriefingPendingPermissions,
  resolveBrowserPreviewBriefingScenario,
} from './browserPreviewBriefingScenarios';

test('full browser preview briefing scenario populates all three columns', () => {
  const config = resolveBrowserPreviewBriefingScenario(BrowserPreviewBriefingScenarioId.Full);
  const briefing = buildWorkBriefing({
    sessions: config.sessionSummaries,
    permissions: config.pendingPermissions,
    activities: config.activityRuns,
    schedules: config.scheduledTasks,
    now: Date.now(),
  });

  expect(briefing.decisionCount).toBeGreaterThan(0);
  expect(briefing.progressedCount).toBeGreaterThan(0);
  expect(briefing.nextCount).toBeGreaterThan(0);
  expect(briefing.decisions[0]?.reasonKey).toBe('briefingNeedsDecision');
  expect(briefing.next.some(item => item.target === BriefingTarget.Schedule)).toBe(true);
});

test('empty browser preview briefing scenario has no invented history', () => {
  const config = resolveBrowserPreviewBriefingScenario(BrowserPreviewBriefingScenarioId.Empty);
  const briefing = buildWorkBriefing({
    sessions: config.sessionSummaries,
    permissions: config.pendingPermissions,
    activities: config.activityRuns,
    schedules: config.scheduledTasks,
    now: Date.now(),
  });
  expect(briefing.hasHistory).toBe(false);
  expect(config.pendingPermissions).toEqual([]);
});

test('preview pending permissions attach to real work sessions only', () => {
  expect(browserPreviewBriefingPendingPermissions.map(permission => permission.sessionId)).toEqual([
    'preview-session-ui-review',
    'preview-session-roadmap',
  ]);
});
