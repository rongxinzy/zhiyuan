// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import {
  BrowserPreviewBriefingScenarioId,
  resolveBrowserPreviewBriefingScenario,
} from '../../browser-preview/browserPreviewBriefingScenarios';
import { browserPreviewWorkspaces } from '../../browser-preview/browserPreviewFixtures';
import type { RootState } from '../../store';
import { TaskBoardView } from './TaskBoardView';

const scenarioState = vi.hoisted(() => ({
  state: null as unknown as RootState,
  loading: false,
  loadFailed: false,
}));

vi.mock('../PageHeader', () => ({
  default: ({ title }: { title?: string }) => (title ? <h1>{title}</h1> : null),
}));

vi.mock('react-redux', () => ({
  useSelector: (selector: (state: RootState) => unknown) => selector(scenarioState.state),
}));

vi.mock('../cowork/briefing/useBriefingData', () => ({
  useBriefingData: () => ({
    loading: scenarioState.loading,
    loadFailed: scenarioState.loadFailed,
    refresh: vi.fn(),
  }),
}));

vi.mock('../../services/cowork', () => ({
  coworkService: { loadSession: vi.fn(async () => ({})) },
}));

vi.mock('../../services/i18n', () => ({
  i18nService: {
    t: (key: string) =>
      (
        {
          taskBoardTitle: '任务看板',
          taskBoardScope: '按状态查看进行中的工作、待确认操作与计划任务。',
          taskBoardColumnPending: '待开始',
          taskBoardColumnInProgress: '进行中',
          taskBoardColumnAwaitingConfirm: '等你确认',
          taskBoardColumnCompleted: '已完成',
          taskBoardColumnEmpty: '暂无条目',
          taskBoardIdleWork: '尚未开始，可随时继续。',
          refresh: '刷新',
          taskBoardColumnNeedsAttention: '需要处理',
          taskBoardStatusNeedsAttention: '需要处理',
          activityErrorInterrupted: '上次运行被中断，可打开记录查看已保存的部分结果。',
          briefingLoading: '加载中',
          briefingLoadFailed: '读取失败',
        } as Record<string, string>
      )[key] ?? key,
    getLanguage: () => 'zh',
    subscribe: () => () => {},
  },
}));

beforeEach(() => {
  const scenario = resolveBrowserPreviewBriefingScenario(BrowserPreviewBriefingScenarioId.Full);
  scenarioState.loading = false;
  scenarioState.loadFailed = false;
  scenarioState.state = {
    cowork: { sessions: scenario.sessionSummaries, pendingPermissions: scenario.pendingPermissions },
    activity: { runs: scenario.activityRuns },
    scheduledTask: { tasks: scenario.scheduledTasks },
    workspace: { workspaces: browserPreviewWorkspaces },
  } as unknown as RootState;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test('renders four kanban columns with preview fixture cards', () => {
  render(<TaskBoardView />);
  expect(screen.getByRole('heading', { name: '任务看板' })).toBeTruthy();
  expect(screen.getByTestId('task-board-columns')).toBeTruthy();
  expect(screen.getByRole('region', { name: '待开始' })).toBeTruthy();
  expect(screen.getByRole('region', { name: '进行中' })).toBeTruthy();
  expect(screen.getByRole('region', { name: '需要处理' })).toBeTruthy();
  expect(screen.getByRole('region', { name: '等你确认' })).toBeTruthy();
  expect(screen.getByRole('region', { name: '已完成' })).toBeTruthy();
  expect(screen.getByText('侧栏 Phase 1 走查')).toBeTruthy();
  expect(screen.getByText('发布流水线预检')).toBeTruthy();
  expect(screen.getAllByText('知远客户端').length).toBeGreaterThan(0);
  expect(screen.getByRole('button', { name: /渠道同步/ })).toBeTruthy();
});
