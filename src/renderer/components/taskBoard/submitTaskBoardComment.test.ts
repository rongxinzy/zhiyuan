import { expect, test, vi } from 'vitest';

import { TaskBoardThreadAuthor } from '../../../shared/taskBoard/constants';
import { submitTaskBoardComment } from './submitTaskBoardComment';

const mocks = vi.hoisted(() => ({
  continueSession: vi.fn(async () => true),
}));

vi.mock('../../services/cowork', () => ({
  coworkService: { continueSession: mocks.continueSession },
}));

test('submitTaskBoardComment appends a user thread entry and resumes the session', async () => {
  const dispatch = vi.fn();
  const ok = await submitTaskBoardComment({
    dispatch,
    threadKey: 'preview-session-ui-review',
    sessionId: 'preview-session-ui-review',
    comment: '  继续整理验收包  ',
  });
  expect(ok).toBe(true);
  expect(dispatch).toHaveBeenCalledWith(
    expect.objectContaining({
      payload: expect.objectContaining({
        threadKey: 'preview-session-ui-review',
        author: TaskBoardThreadAuthor.User,
        body: '继续整理验收包',
      }),
    }),
  );
  expect(mocks.continueSession).toHaveBeenCalledWith({
    sessionId: 'preview-session-ui-review',
    prompt: '继续整理验收包',
  });
});
