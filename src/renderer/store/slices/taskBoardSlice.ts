import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import {
  TaskBoardThreadAuthor,
  type TaskBoardThreadEntry,
  type TaskBoardWorkEvent,
} from '../../../shared/taskBoard/constants';

export interface TaskBoardState {
  selectedThreadKey: string | null;
  selectedCardId: string | null;
  threads: Record<string, TaskBoardThreadEntry[]>;
  conclusionByThreadKey: Record<string, string>;
}

const initialState: TaskBoardState = {
  selectedThreadKey: null,
  selectedCardId: null,
  threads: {},
  conclusionByThreadKey: {},
};

function appendEntry(
  state: TaskBoardState,
  entry: Omit<TaskBoardThreadEntry, 'id' | 'createdAt'> & { id?: string; createdAt?: number },
): void {
  const list = state.threads[entry.threadKey] ?? [];
  state.threads[entry.threadKey] = [
    ...list,
    {
      id: entry.id ?? crypto.randomUUID(),
      threadKey: entry.threadKey,
      author: entry.author,
      body: entry.body,
      createdAt: entry.createdAt ?? Date.now(),
    },
  ];
}

const taskBoardSlice = createSlice({
  name: 'taskBoard',
  initialState,
  reducers: {
    selectTaskBoardCard(
      state,
      action: PayloadAction<{ cardId: string; threadKey: string } | null>,
    ) {
      if (!action.payload) {
        state.selectedCardId = null;
        state.selectedThreadKey = null;
        return;
      }
      state.selectedCardId = action.payload.cardId;
      state.selectedThreadKey = action.payload.threadKey;
    },
    appendTaskBoardThreadEntry(
      state,
      action: PayloadAction<Omit<TaskBoardThreadEntry, 'id' | 'createdAt'> & { id?: string }>,
    ) {
      appendEntry(state, action.payload);
    },
    applyTaskBoardWorkEvent(state, action: PayloadAction<TaskBoardWorkEvent>) {
      const event = action.payload;
      const body = event.summary?.trim();
      if (body) {
        state.conclusionByThreadKey[event.threadKey] = body;
      }
      const systemKey =
        event.kind === 'started'
          ? 'taskBoardEventStarted'
          : event.kind === 'needs_confirmation'
            ? 'taskBoardEventNeedsConfirmation'
            : event.kind === 'result_produced'
              ? 'taskBoardEventResultProduced'
              : 'taskBoardEventFailed';
      appendEntry(state, {
        threadKey: event.threadKey,
        author: TaskBoardThreadAuthor.System,
        body: systemKey,
        createdAt: event.timestamp,
      });
      if (body) {
        appendEntry(state, {
          threadKey: event.threadKey,
          author: TaskBoardThreadAuthor.Ai,
          body,
          createdAt: event.timestamp + 1,
        });
      }
    },
    seedTaskBoardPreviewThread(
      state,
      action: PayloadAction<{ threadKey: string; entries: TaskBoardThreadEntry[]; conclusion?: string }>,
    ) {
      state.threads[action.payload.threadKey] = action.payload.entries;
      if (action.payload.conclusion) {
        state.conclusionByThreadKey[action.payload.threadKey] = action.payload.conclusion;
      }
    },
  },
});

export const {
  selectTaskBoardCard,
  appendTaskBoardThreadEntry,
  applyTaskBoardWorkEvent,
  seedTaskBoardPreviewThread,
} = taskBoardSlice.actions;
export default taskBoardSlice.reducer;
