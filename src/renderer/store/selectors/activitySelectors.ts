import { createSelector } from '@reduxjs/toolkit';

import { ActivityStatus } from '../../../shared/activity/constants';
import type { RootState } from '../index';

export type { ActivityRun } from '../../../shared/activity/types';
const selectRuns = (state: RootState) => state.activity.runs;
export const selectActivityRuns = createSelector(selectRuns, runs => runs);

/** Whether any activity run is currently in progress. */
export const selectHasActiveActivityRun = createSelector(selectActivityRuns, runs =>
  runs.some(run => run.status === ActivityStatus.Running),
);
