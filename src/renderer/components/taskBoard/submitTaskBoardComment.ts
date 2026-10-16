import { TaskBoardThreadAuthor } from '../../../shared/taskBoard/constants';
import { coworkService } from '../../services/cowork';
import type { AppDispatch } from '../../store';
import { appendTaskBoardThreadEntry } from '../../store/slices/taskBoardSlice';

export async function submitTaskBoardComment(options: {
  dispatch: AppDispatch;
  threadKey: string;
  sessionId: string;
  comment: string;
}): Promise<boolean> {
  const trimmed = options.comment.trim();
  if (!trimmed) return false;

  options.dispatch(
    appendTaskBoardThreadEntry({
      threadKey: options.threadKey,
      author: TaskBoardThreadAuthor.User,
      body: trimmed,
    }),
  );

  const ok = await coworkService.continueSession({
    sessionId: options.sessionId,
    prompt: trimmed,
  });
  return ok;
}
