import { configureStore } from '@reduxjs/toolkit';

import agentReducer from './slices/agentSlice';
import artifactReducer from './slices/artifactSlice';
import activityReducer from './slices/activitySlice';
import coworkReducer from './slices/coworkSlice';
import coworkRunReducer from './slices/coworkRunSlice';
import modelReducer from './slices/modelSlice';
import scheduledTaskReducer from './slices/scheduledTaskSlice';
import workspaceReducer from './slices/workspaceSlice';
import workModeReducer from './workMode/workModeSlice';

export const store = configureStore({
  reducer: {
    model: modelReducer,
    cowork: coworkReducer,
    coworkRun: coworkRunReducer,
    scheduledTask: scheduledTaskReducer,
    agent: agentReducer,
    artifact: artifactReducer,
    activity: activityReducer,
    workspace: workspaceReducer,
    workMode: workModeReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
