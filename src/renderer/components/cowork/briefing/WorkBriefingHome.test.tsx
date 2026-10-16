// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  ActivityErrorCode,
  ActivitySource,
  ActivityStatus,
} from '../../../../shared/activity/constants';
import { CoworkPermissionOrigin } from '../../../../shared/cowork/constants';
import { briefingTranslations } from '../../../services/briefingTranslations';
import { RAW_I18N_KEY_PATTERN, WorkBriefingHome } from './WorkBriefingHome';
import {
  CoworkSessionMode,
  CoworkSessionSource,
  CoworkSessionStatus,
} from '../../../../shared/cowork/constants';
import type { CoworkSessionSummary } from '../../../types/cowork';
import type { RootState } from '../../../store';

const { current, loadSession, dispatch, refresh, toast } = vi.hoisted(() => ({
  current: { state: null as unknown as RootState, loading: false, loadFailed: false },
  loadSession: vi.fn(),
  dispatch: vi.fn(),
  refresh: vi.fn(),
  toast: vi.fn(),
}));
vi.mock('react-redux', () => ({
  useDispatch: () => dispatch,
  useSelector: (selector: (state: RootState) => unknown) => selector(current.state),
}));
vi.mock('./useBriefingData', () => ({
  useBriefingData: () => ({ loading: current.loading, loadFailed: current.loadFailed, refresh }),
}));
vi.mock('../../../services/cowork', () => ({ coworkService: { loadSession } }));
vi.mock('../../../services/toastNotification', () => ({ showAppErrorToast: toast }));
const zhCopy = {
  ...briefingTranslations.zh,
  activityErrorInterrupted: '上次运行被中断，可打开记录查看已保存的部分结果。',
  briefingPageRange: '{from}–{to} / {count}',
} as Record<string, string>;

vi.mock('../../../services/i18n', () => ({
  i18nService: {
    t: (key: string) => zhCopy[key] ?? key,
    getLanguage: () => 'zh',
    subscribe: () => () => {},
  },
}));
vi.mock('../../MarkdownContent', () => ({
  default: ({ content }: { content: string }) => <div>{content}</div>,
}));
const sessions = (count: number): CoworkSessionSummary[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `work-${i}`,
    title: `Work ${i}`,
    status: CoworkSessionStatus.Completed,
    mode: CoworkSessionMode.Work,
    source: CoworkSessionSource.Manual,
    pinned: false,
    createdAt: Date.now(),
    updatedAt: Date.now() - 1000 - i,
  }));
const home = () => (
  <WorkBriefingHome
    header={<h1>Briefing</h1>}
    prompt={<textarea aria-label="Work input" />}
    onFocusInput={vi.fn()}
  />
);
const expandComposer = () => {
  fireEvent.click(screen.getByRole('button', { name: zhCopy.briefingQuickInput }));
};
beforeEach(() => {
  vi.clearAllMocks();
  current.loading = false;
  current.loadFailed = false;
  loadSession.mockResolvedValue({ id: 'opened' });
  current.state = {
    cowork: { sessions: [], pendingPermissions: [] },
    activity: { runs: [] },
    scheduledTask: { tasks: [], listError: null },
  } as unknown as RootState;
});
afterEach(cleanup);

test('all loaded records remain keyboard reachable without rendering an unbounded list', async () => {
  current.state.cowork.sessions = sessions(8);
  const user = userEvent.setup();
  render(home());
  const section = screen.getByRole('region', { name: /已为你推进/ });
  expect(within(section).getAllByRole('listitem')).toHaveLength(5);
  expect(screen.queryByText('Work 7')).toBeNull();
  const next = within(section).getByRole('button', { name: zhCopy.briefingNextPage });
  next.focus();
  await user.keyboard('{Enter}');
  expect(within(section).getAllByRole('listitem')).toHaveLength(3);
  expect(screen.getByText('Work 7')).toBeTruthy();
  expect(screen.getByText('6–8 / 8')).toBeTruthy();
  expect(next).toBeDisabled();
  await user.click(within(section).getAllByRole('button', { name: zhCopy.briefingViewWork })[2]);
  expect(loadSession).toHaveBeenCalledWith('work-7');
  await user.click(within(section).getByRole('button', { name: zhCopy.briefingPreviousPage }));
  expect(screen.getByText('Work 0')).toBeTruthy();
});

test('clamps the current page when refreshed records shrink and retains the input draft', () => {
  current.state.cowork.sessions = sessions(11);
  const view = render(home());
  expandComposer();
  fireEvent.change(screen.getByRole('textbox', { name: 'Work input' }), {
    target: { value: 'Keep this draft' },
  });
  fireEvent.click(screen.getByRole('button', { name: zhCopy.briefingNextPage }));
  fireEvent.click(screen.getByRole('button', { name: zhCopy.briefingNextPage }));
  expect(screen.getByText('Work 10')).toBeTruthy();
  current.state = { ...current.state, cowork: { ...current.state.cowork, sessions: sessions(2) } };
  view.rerender(home());
  expect(screen.getByText('Work 0')).toBeTruthy();
  expect(screen.queryByRole('navigation')).toBeNull();
  expect(screen.getByRole('textbox', { name: 'Work input' })).toHaveValue('Keep this draft');
});

test('keeps loading and failure distinct from a new-user empty state', () => {
  current.loading = true;
  const view = render(home());
  expect(screen.queryByText(zhCopy.briefingNewWork)).toBeNull();
  current.loading = false;
  current.loadFailed = true;
  view.rerender(home());
  expect(screen.getByRole('alert')).toHaveTextContent(zhCopy.briefingLoadFailed);
  expect(screen.queryByText(zhCopy.briefingNewWork)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: zhCopy.briefingRefresh }));
  expect(refresh).toHaveBeenCalledOnce();
  current.loadFailed = false;
  view.rerender(home());
  expect(screen.getByText(zhCopy.briefingNewWork)).toBeTruthy();
});

test('expands real long activity output and can open its work without issuing execution commands', async () => {
  const text = 'Actual output '.repeat(1000);
  current.state.activity.runs = [
    {
      id: 'run',
      source: ActivitySource.ScheduledTask,
      status: ActivityStatus.Running,
      startedAt: Date.now(),
      updatedAt: Date.now(),
      taskName: 'Running task',
      sessionId: 'actual-session',
      replyPreview: text,
    },
  ];
  render(home());
  expect(screen.getByText(zhCopy.briefingRunning)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: zhCopy.briefingViewActivity }));
  expect(screen.getByRole('button', { name: zhCopy.briefingCollapseRecord })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  expect(screen.getByText(text.trim())).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: zhCopy.briefingViewWork }));
  await waitFor(() => expect(loadSession).toHaveBeenCalledWith('actual-session'));
  expect(screen.getByRole('button', { name: zhCopy.briefingQuickInput })).toBeTruthy();
  expect(screen.getByRole('region', { name: /已为你推进/ }).parentElement?.className).toContain(
    'grid-cols-1',
  );
});

test('does not render raw i18n keys for interrupted activity errors', () => {
  current.state.activity.runs = [
    {
      id: 'interrupted',
      source: ActivitySource.ScheduledTask,
      status: ActivityStatus.Failed,
      startedAt: Date.now(),
      updatedAt: Date.now(),
      taskName: '渠道同步',
      errorMessage: ActivityErrorCode.Interrupted,
    },
  ];
  render(home());
  const text = document.body.textContent ?? '';
  expect(text).toContain(zhCopy.activityErrorInterrupted);
  expect(text).not.toMatch(RAW_I18N_KEY_PATTERN);
  expect(text).not.toContain(ActivityErrorCode.Interrupted);
});

test('shows a specific permission headline instead of the generic decision copy', () => {
  current.state.cowork.sessions = [
    {
      id: 'work-0',
      title: '清理构建产物',
      status: CoworkSessionStatus.Running,
      mode: CoworkSessionMode.Work,
      source: CoworkSessionSource.Manual,
      pinned: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  ];
  current.state.cowork.pendingPermissions = [
    {
      origin: CoworkPermissionOrigin.PiWorkbench,
      sessionId: 'work-0',
      requestId: 'perm-1',
      toolName: 'bash',
      toolInput: { command: 'rm -rf dist/a dist/b dist/c' },
    },
  ];
  render(home());
  expect(screen.getByText('要删除 3 个旧构建产物，需要你确认')).toBeTruthy();
  expect(screen.queryByText(zhCopy.briefingNeedsDecision)).toBeNull();
});

test('failed navigation reports an actionable error instead of starting work', async () => {
  current.state.cowork.sessions = sessions(1);
  loadSession.mockResolvedValue(null);
  render(home());
  fireEvent.click(screen.getByRole('button', { name: zhCopy.briefingViewWork }));
  await waitFor(() => expect(toast).toHaveBeenCalledWith(zhCopy.briefingOpenFailed));
});
