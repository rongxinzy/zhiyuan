import type { Dispatch } from '@reduxjs/toolkit';

import {
  clearPendingPermissions,
  enqueuePendingPermission,
  setSessions,
} from '../store/slices/coworkSlice';
import { hydrateRuns } from '../store/slices/activitySlice';
import { setListError, setTasks } from '../store/slices/scheduledTaskSlice';
import {
  applyBrowserPreviewBriefingScenario,
  type BrowserPreviewBriefingScenarioConfig,
  type BrowserPreviewBriefingScenarioId,
  withStableUpcomingSchedule,
} from './browserPreviewBriefingScenarios';

export function applyBrowserPreviewBriefingToStore(
  dispatch: Dispatch,
  config: BrowserPreviewBriefingScenarioConfig,
): void {
  dispatch(clearPendingPermissions());
  dispatch(setSessions(config.sessionSummaries));
  dispatch(hydrateRuns(config.activityRuns));
  dispatch(setTasks(withStableUpcomingSchedule(config.scheduledTasks)));
  dispatch(setListError(null));
  for (const permission of config.pendingPermissions) {
    dispatch(enqueuePendingPermission(permission));
  }
}

export function switchBrowserPreviewBriefingScenario(
  dispatch: Dispatch,
  scenarioId: BrowserPreviewBriefingScenarioId,
): BrowserPreviewBriefingScenarioConfig {
  const config = applyBrowserPreviewBriefingScenario(scenarioId);
  applyBrowserPreviewBriefingToStore(dispatch, config);
  window.dispatchEvent(new CustomEvent('browser-preview:briefing-refresh'));
  return config;
}
