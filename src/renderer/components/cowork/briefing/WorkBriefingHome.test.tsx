// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { WorkBriefingHome } from './WorkBriefingHome';
import { ActivitySource, ActivityStatus } from '../../../../shared/activity/constants';
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
vi.mock('../../../services/i18n', () => ({
  i18nService: {
    t: (key: string) => (key === 'briefingPageRange' ? '{from}–{to} / {count}' : key),
    getLanguage: () => 'en',
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
  const section = screen.getByRole('region', { name: /briefingProgressed/ });
  expect(within(section).getAllByRole('listitem')).toHaveLength(5);
  expect(screen.queryByText('Work 7')).toBeNull();
  const next = within(section).getByRole('button', { name: 'briefingNextPage' });
  next.focus();
  await user.keyboard('{Enter}');
  expect(within(section).getAllByRole('listitem')).toHaveLength(3);
  expect(screen.getByText('Work 7')).toBeTruthy();
  expect(screen.getByText('6–8 / 8')).toBeTruthy();
  expect(next).toBeDisabled();
  await user.click(within(section).getAllByRole('button', { name: 'briefingViewWork' })[2]);
  expect(loadSession).toHaveBeenCalledWith('work-7');
  await user.click(within(section).getByRole('button', { name: 'briefingPreviousPage' }));
  expect(screen.getByText('Work 0')).toBeTruthy();
});

test('clamps the current page when refreshed records shrink and retains the input draft', () => {
  current.state.cowork.sessions = sessions(11);
  const view = render(home());
  fireEvent.change(screen.getByRole('textbox', { name: 'Work input' }), {
    target: { value: 'Keep this draft' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'briefingNextPage' }));
  fireEvent.click(screen.getByRole('button', { name: 'briefingNextPage' }));
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
  expect(screen.queryByText('briefingNewWork')).toBeNull();
  current.loading = false;
  current.loadFailed = true;
  view.rerender(home());
  expect(screen.getByRole('alert')).toHaveTextContent('briefingLoadFailed');
  expect(screen.queryByText('briefingNewWork')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'briefingRefresh' }));
  expect(refresh).toHaveBeenCalledOnce();
  current.loadFailed = false;
  view.rerender(home());
  expect(screen.getByText('briefingNewWork')).toBeTruthy();
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
  expect(screen.getByText('briefingRunning')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'briefingViewActivity' }));
  expect(screen.getByRole('button', { name: 'briefingCollapseRecord' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  expect(screen.getByText(text.trim())).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'briefingViewWork' }));
  await waitFor(() => expect(loadSession).toHaveBeenCalledWith('actual-session'));
  const input = screen.getByRole('textbox', { name: 'Work input' });
  expect(input.parentElement?.parentElement?.className).toContain('shrink-0');
  expect(
    screen.getByRole('region', { name: /briefingProgressed/ }).parentElement?.className,
  ).toContain('grid-cols-1');
});

test('failed navigation reports an actionable error instead of starting work', async () => {
  current.state.cowork.sessions = sessions(1);
  loadSession.mockResolvedValue(null);
  render(home());
  fireEvent.click(screen.getByRole('button', { name: 'briefingViewWork' }));
  await waitFor(() => expect(toast).toHaveBeenCalledWith('briefingOpenFailed'));
});
