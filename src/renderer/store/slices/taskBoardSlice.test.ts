import { expect, test } from 'vitest';

import {
  TaskBoardThreadAuthor,
  TaskBoardWorkEventKind,
} from '../../../shared/taskBoard/constants';
import taskBoardReducer, {
  applyTaskBoardWorkEvent,
  appendTaskBoardThreadEntry,
} from './taskBoardSlice';

test('applyTaskBoardWorkEvent appends system and AI lines with conclusion', () => {
  let state = taskBoardReducer(undefined, { type: 'init' });
  state = taskBoardReducer(
    state,
    applyTaskBoardWorkEvent({
      kind: TaskBoardWorkEventKind.ResultProduced,
      threadKey: 'session-1',
      sessionId: 'session-1',
      summary: 'Done.',
      timestamp: 1000,
    }),
  );
  expect(state.conclusionByThreadKey['session-1']).toBe('Done.');
  expect(state.threads['session-1']).toHaveLength(2);
  expect(state.threads['session-1'][1].author).toBe(TaskBoardThreadAuthor.Ai);
});

test('appendTaskBoardThreadEntry stores user comments', () => {
  const state = taskBoardReducer(
    undefined,
    appendTaskBoardThreadEntry({
      threadKey: 'session-2',
      author: TaskBoardThreadAuthor.User,
      body: 'Please continue',
    }),
  );
  expect(state.threads['session-2'][0].body).toBe('Please continue');
});
