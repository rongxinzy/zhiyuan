import {
  TaskBoardThreadAuthor,
  TaskBoardWorkEventKind,
  type TaskBoardWorkEvent,
} from '../../shared/taskBoard/constants';
import { BrowserPreviewFixtureId } from './browserPreviewFixtures';
import type { AppDispatch } from '../store';
import { seedTaskBoardPreviewThread } from '../store/slices/taskBoardSlice';

const UI_REVIEW_SESSION = 'preview-session-ui-review';

function emitPreviewWorkEvent(event: TaskBoardWorkEvent): void {
  window.dispatchEvent(
    new CustomEvent('browser-preview:task-board-work-event', { detail: event }),
  );
}

export function seedBrowserPreviewTaskBoardDemo(dispatch: AppDispatch): void {
  if (!import.meta.env.VITE_BROWSER_PREVIEW) return;
  const threadKey = UI_REVIEW_SESSION;
  dispatch(
    seedTaskBoardPreviewThread({
      threadKey,
      conclusion: '侧栏截图与 DESIGN.md 基准已对齐；任务看板交互可在浏览器预览中演示。',
      entries: [
        {
          id: 'preview-thread-1',
          threadKey,
          author: TaskBoardThreadAuthor.User,
          body: '请把 Phase 1 导航截图补进验收包，并更新看板夹具。',
          createdAt: Date.now() - 120_000,
        },
        {
          id: 'preview-thread-2',
          threadKey,
          author: TaskBoardThreadAuthor.Ai,
          body: '已生成 1440×900 浅色/深色截图，并写入 docs/theme-previews。',
          createdAt: Date.now() - 60_000,
        },
      ],
    }),
  );
}

export function runBrowserPreviewTaskBoardCommentDemo(sessionId: string, comment: string): void {
  if (!import.meta.env.VITE_BROWSER_PREVIEW) return;
  if (sessionId !== UI_REVIEW_SESSION && sessionId !== BrowserPreviewFixtureId.SessionRoadmap) {
    return;
  }
  const threadKey = sessionId;
  const now = Date.now();
  window.setTimeout(() => {
    emitPreviewWorkEvent({
      kind: TaskBoardWorkEventKind.Started,
      threadKey,
      sessionId,
      timestamp: now + 400,
    });
  }, 300);
  window.setTimeout(() => {
    emitPreviewWorkEvent({
      kind: TaskBoardWorkEventKind.ResultProduced,
      threadKey,
      sessionId,
      summary: `已根据你的指令处理：「${comment.trim().slice(0, 80)}」`,
      timestamp: now + 1200,
    });
  }, 900);
}
