import { AgentId } from '@shared/agent';

import { ActivitySource, ActivityStatus } from '../../shared/activity/constants';
import type { ActivityRun } from '../../shared/activity/types';
import {
  CoworkExecutionMode,
  CoworkSessionMode,
  CoworkSessionSource,
  CoworkSessionStatus,
} from '../../shared/cowork/constants';
import { SessionTarget, TaskStatus, WakeMode } from '../../scheduledTask/constants';
import type { ScheduledTask } from '../../scheduledTask/types';
import type { Workspace } from '../../shared/workspace';
import type { LlamaCppModel, LlamaCppStatusSnapshot } from '../../shared/llamacpp/types';
import type { CoworkMessage, CoworkSession, CoworkSessionSummary } from '../types/cowork';

export const BrowserPreviewFixtureId = {
  WorkspaceMain: 'preview-ws-main',
  WorkspaceResearch: 'preview-ws-research',
  WorkspaceOps: 'preview-ws-ops',
  SessionRoadmap: 'preview-session-roadmap',
  SessionApiDocs: 'preview-session-api-docs',
  SessionChatWeekly: 'preview-session-chat-weekly',
  SessionScheduledDigest: 'preview-session-scheduled-digest',
  AgentMain: AgentId.Main,
  AgentResearch: 'preview-agent-research',
} as const;

const now = Date.now();
const hoursAgo = (h: number) => now - h * 60 * 60 * 1000;
const minutesFromNow = (m: number) => now + m * 60 * 1000;

export const browserPreviewWorkspaces: Workspace[] = [
  {
    id: BrowserPreviewFixtureId.WorkspaceMain,
    name: '知远客户端',
    path: '/Users/demo/Projects/zhiyuan-agent',
    folders: ['docs', 'src/renderer'],
    isHidden: false,
    pinned: true,
    createdAt: hoursAgo(720),
    updatedAt: hoursAgo(2),
  },
  {
    id: BrowserPreviewFixtureId.WorkspaceResearch,
    name: '市场研究',
    path: '/Users/demo/Projects/market-research',
    folders: ['reports'],
    isHidden: false,
    pinned: true,
    createdAt: hoursAgo(480),
    updatedAt: hoursAgo(5),
  },
  {
    id: BrowserPreviewFixtureId.WorkspaceOps,
    name: '运维值班',
    path: '/Users/demo/Projects/oncall',
    isHidden: false,
    pinned: false,
    createdAt: hoursAgo(240),
    updatedAt: hoursAgo(12),
  },
];

export const browserPreviewAgents = [
  {
    id: BrowserPreviewFixtureId.AgentMain,
    name: '默认助手',
    description: '通用工作与代码协作',
    icon: '',
    model: 'qwen3-235b-cloud',
    workingDirectory: browserPreviewWorkspaces[0].path,
    enabled: true,
    pinned: true,
    pinOrder: 0,
    isDefault: true,
    source: 'package' as const,
    presetId: '',
    systemPrompt: '',
  },
  {
    id: BrowserPreviewFixtureId.AgentResearch,
    name: '研究分析',
    description: '长文档阅读与结构化输出',
    icon: '',
    model: 'deepseek-v3-cloud',
    workingDirectory: browserPreviewWorkspaces[1].path,
    enabled: true,
    pinned: false,
    pinOrder: null,
    isDefault: false,
    source: 'package' as const,
    presetId: '',
    systemPrompt: '',
  },
];

const roadmapMessages: CoworkMessage[] = [
  {
    id: 'msg-roadmap-1',
    type: 'user',
    content: '帮我整理本季度产品路线图要点，重点对比 Phase 1 侧栏收敛与本地推理体验。',
    timestamp: hoursAgo(1.2),
    sequence: 1,
  },
  {
    id: 'msg-roadmap-2',
    type: 'assistant',
    content: '我会先阅读路线图文档和 Issue 列表，再输出可执行的里程碑摘要。',
    timestamp: hoursAgo(1.15),
    sequence: 2,
    metadata: { isThinking: false, model: 'qwen3-235b-cloud' },
  },
  {
    id: 'msg-roadmap-3',
    type: 'tool_use',
    content: '',
    timestamp: hoursAgo(1.1),
    sequence: 3,
    metadata: {
      toolName: 'read',
      toolInput: { path: 'docs/product-evolution-roadmap-2026.md' },
      toolUseId: 'tool-roadmap-read',
    },
  },
  {
    id: 'msg-roadmap-4',
    type: 'tool_result',
    content: '已读取路线图：Phase 1 聚焦导航收敛、Work 首页简报、本地推理入口统一。',
    timestamp: hoursAgo(1.05),
    sequence: 4,
    metadata: { toolUseId: 'tool-roadmap-read', toolName: 'read' },
  },
  {
    id: 'msg-roadmap-5',
    type: 'assistant',
    content:
      '## 本季度要点\n\n1. **导航收敛**：主侧栏保留「会话与工作」「本地推理」，技能/MCP 与设置固定底部。\n2. **Work 首页**：以简报聚合进行中的会话、活动与计划任务。\n3. **本地推理**：统一模型目录、运行态与 Magpie 云模型切换。\n\n下一步建议先完成浏览器预览夹具，便于设计验收。',
    timestamp: hoursAgo(1),
    sequence: 5,
    metadata: { isFinalAnswer: true, model: 'qwen3-235b-cloud' },
  },
];

const apiDocMessages: CoworkMessage[] = [
  {
    id: 'msg-api-1',
    type: 'user',
    content: '同步 OpenAPI 变更到内部文档，并生成中文摘要。',
    timestamp: hoursAgo(3),
    sequence: 1,
  },
  {
    id: 'msg-api-2',
    type: 'assistant',
    content: '已完成 12 个接口变更比对，新增 2 个 breaking change 提醒。',
    timestamp: hoursAgo(2.8),
    sequence: 2,
    metadata: { isFinalAnswer: true },
  },
];

function buildSession(
  summary: CoworkSessionSummary,
  messages: CoworkMessage[],
  cwd: string,
): CoworkSession {
  return {
    ...summary,
    cwd,
    systemPrompt: '',
    modelOverride: '',
    executionMode: CoworkExecutionMode.Auto,
    activeSkillIds: [],
    workspaceId: summary.workspaceId ?? BrowserPreviewFixtureId.WorkspaceMain,
    agentId: summary.agentId ?? BrowserPreviewFixtureId.AgentMain,
    messages,
    messagesOffset: 0,
    totalMessages: messages.length,
    artifacts: [],
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
  };
}

export const browserPreviewSessionSummaries: CoworkSessionSummary[] = [
  {
    id: BrowserPreviewFixtureId.SessionRoadmap,
    title: '季度路线图整理',
    status: CoworkSessionStatus.Completed,
    mode: CoworkSessionMode.Work,
    source: CoworkSessionSource.Manual,
    pinned: true,
    pinOrder: 0,
    workspaceId: BrowserPreviewFixtureId.WorkspaceMain,
    agentId: BrowserPreviewFixtureId.AgentMain,
    createdAt: hoursAgo(6),
    updatedAt: hoursAgo(1),
  },
  {
    id: BrowserPreviewFixtureId.SessionApiDocs,
    title: 'API 文档同步',
    status: CoworkSessionStatus.Completed,
    mode: CoworkSessionMode.Work,
    source: CoworkSessionSource.Manual,
    pinned: false,
    workspaceId: BrowserPreviewFixtureId.WorkspaceMain,
    agentId: BrowserPreviewFixtureId.AgentMain,
    createdAt: hoursAgo(24),
    updatedAt: hoursAgo(2.8),
  },
  {
    id: 'preview-session-ui-review',
    title: '侧栏 Phase 1 走查',
    status: CoworkSessionStatus.Running,
    mode: CoworkSessionMode.Work,
    source: CoworkSessionSource.Manual,
    pinned: false,
    workspaceId: BrowserPreviewFixtureId.WorkspaceMain,
    agentId: BrowserPreviewFixtureId.AgentMain,
    createdAt: hoursAgo(4),
    updatedAt: hoursAgo(0.3),
    runStartedAt: hoursAgo(0.3),
  },
  {
    id: 'preview-session-competitor',
    title: '竞品功能矩阵',
    status: CoworkSessionStatus.Completed,
    mode: CoworkSessionMode.Work,
    source: CoworkSessionSource.Manual,
    pinned: false,
    workspaceId: BrowserPreviewFixtureId.WorkspaceResearch,
    agentId: BrowserPreviewFixtureId.AgentResearch,
    createdAt: hoursAgo(48),
    updatedAt: hoursAgo(4),
  },
  {
    id: 'preview-session-survey',
    title: '用户访谈纪要',
    status: CoworkSessionStatus.Idle,
    mode: CoworkSessionMode.Work,
    source: CoworkSessionSource.Manual,
    pinned: false,
    workspaceId: BrowserPreviewFixtureId.WorkspaceResearch,
    agentId: BrowserPreviewFixtureId.AgentResearch,
    createdAt: hoursAgo(72),
    updatedAt: hoursAgo(20),
  },
  {
    id: BrowserPreviewFixtureId.SessionScheduledDigest,
    title: '每日站会摘要',
    status: CoworkSessionStatus.Completed,
    mode: CoworkSessionMode.Work,
    source: CoworkSessionSource.Scheduled,
    pinned: false,
    workspaceId: BrowserPreviewFixtureId.WorkspaceOps,
    agentId: BrowserPreviewFixtureId.AgentMain,
    createdAt: hoursAgo(30),
    updatedAt: hoursAgo(8),
  },
  {
    id: BrowserPreviewFixtureId.SessionChatWeekly,
    title: '本周灵感',
    status: CoworkSessionStatus.Completed,
    mode: CoworkSessionMode.Chat,
    source: CoworkSessionSource.Manual,
    pinned: false,
    workspaceId: BrowserPreviewFixtureId.WorkspaceMain,
    agentId: BrowserPreviewFixtureId.AgentMain,
    createdAt: hoursAgo(12),
    updatedAt: hoursAgo(6),
  },
  {
    id: 'preview-session-chat-support',
    title: '快速问答',
    status: CoworkSessionStatus.Idle,
    mode: CoworkSessionMode.Chat,
    source: CoworkSessionSource.Manual,
    pinned: false,
    workspaceId: BrowserPreviewFixtureId.WorkspaceMain,
    agentId: BrowserPreviewFixtureId.AgentMain,
    createdAt: hoursAgo(2),
    updatedAt: hoursAgo(1.5),
  },
];

const sessionCwdByWorkspace: Record<string, string> = {
  [BrowserPreviewFixtureId.WorkspaceMain]: browserPreviewWorkspaces[0].path,
  [BrowserPreviewFixtureId.WorkspaceResearch]: browserPreviewWorkspaces[1].path,
  [BrowserPreviewFixtureId.WorkspaceOps]: browserPreviewWorkspaces[2].path,
};

const sessionMessagesById: Record<string, CoworkMessage[]> = {
  [BrowserPreviewFixtureId.SessionRoadmap]: roadmapMessages,
  [BrowserPreviewFixtureId.SessionApiDocs]: apiDocMessages,
  [BrowserPreviewFixtureId.SessionChatWeekly]: [
    {
      id: 'msg-chat-1',
      type: 'user',
      content: '用三句话解释 Work 与 Chat 在产品里的分工。',
      timestamp: hoursAgo(6.1),
      sequence: 1,
    },
    {
      id: 'msg-chat-2',
      type: 'assistant',
      content:
        'Work 面向项目上下文与交付物；Chat 面向轻量对话；两者共享同一运行时，但首页布局不同。',
      timestamp: hoursAgo(6),
      sequence: 2,
      metadata: { isFinalAnswer: true },
    },
  ],
};

export function getBrowserPreviewSession(sessionId: string): CoworkSession | null {
  const summary = browserPreviewSessionSummaries.find(session => session.id === sessionId);
  if (!summary) return null;
  const workspaceId = summary.workspaceId ?? BrowserPreviewFixtureId.WorkspaceMain;
  const cwd = sessionCwdByWorkspace[workspaceId] ?? browserPreviewWorkspaces[0].path;
  const messages = sessionMessagesById[sessionId] ?? [
    {
      id: `${sessionId}-placeholder`,
      type: 'assistant',
      content: '（浏览器预览）该会话暂无详细消息夹具。',
      timestamp: summary.updatedAt,
      sequence: 1,
    },
  ];
  return buildSession(summary, messages, cwd);
}

export function filterBrowserPreviewSessionSummaries(options?: {
  limit?: number;
  offset?: number;
  workspaceId?: string;
  mode?: (typeof CoworkSessionMode)[keyof typeof CoworkSessionMode];
  sources?: (typeof CoworkSessionSource)[keyof typeof CoworkSessionSource][];
}): { sessions: CoworkSessionSummary[]; hasMore: boolean } {
  const offset = options?.offset ?? 0;
  const limit = options?.limit ?? 50;
  let sessions = [...browserPreviewSessionSummaries];
  if (options?.workspaceId) {
    sessions = sessions.filter(session => session.workspaceId === options.workspaceId);
  }
  if (options?.mode) {
    sessions = sessions.filter(
      session => (session.mode ?? CoworkSessionMode.Work) === options.mode,
    );
  }
  if (options?.sources?.length) {
    sessions = sessions.filter(session => options.sources!.includes(session.source));
  }
  sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  const slice = sessions.slice(offset, offset + limit);
  return { sessions: slice, hasMore: offset + limit < sessions.length };
}

export const browserPreviewActivityRuns: ActivityRun[] = [
  {
    id: 'activity-running-1',
    source: ActivitySource.ScheduledTask,
    status: ActivityStatus.Running,
    startedAt: hoursAgo(0.4),
    updatedAt: hoursAgo(0.1),
    sessionId: 'preview-session-ui-review',
    taskName: '侧栏验收截图',
    inputPreview: '生成 Phase 1 侧栏浅色/深色截图',
    replyPreview: '正在渲染浏览器预览并写入 docs/theme-previews…',
  },
  {
    id: 'activity-completed-1',
    source: ActivitySource.ScheduledTask,
    status: ActivityStatus.Completed,
    startedAt: hoursAgo(5),
    updatedAt: hoursAgo(4.5),
    sessionId: BrowserPreviewFixtureId.SessionApiDocs,
    taskName: 'API 文档同步',
    inputPreview: '同步 OpenAPI 3.1 变更',
    replyPreview: '已更新 12 个接口说明并推送摘要。',
  },
];

export const browserPreviewScheduledTasks: ScheduledTask[] = [
  {
    id: 'preview-task-daily-standup',
    name: '每日站会摘要',
    description: '汇总昨日合并的 PR 与待办',
    enabled: true,
    schedule: { kind: 'cron', expr: '0 9 * * 1-5', tz: 'Asia/Shanghai' },
    sessionTarget: SessionTarget.Main,
    wakeMode: WakeMode.NextHeartbeat,
    payload: { kind: 'agentTurn', message: '生成站会摘要' },
    workspaceId: BrowserPreviewFixtureId.WorkspaceOps,
    sessionKey: null,
    state: {
      nextRunAtMs: minutesFromNow(90),
      lastRunAtMs: hoursAgo(24),
      lastStatus: TaskStatus.Completed,
      lastError: null,
      lastDurationMs: 45_000,
      runningAtMs: null,
      consecutiveErrors: 0,
    },
    createdAt: new Date(hoursAgo(200)).toISOString(),
    updatedAt: new Date(hoursAgo(24)).toISOString(),
  },
  {
    id: 'preview-task-weekly-report',
    name: '周报草稿',
    description: '每周五 17:00 生成周报要点',
    enabled: true,
    schedule: { kind: 'cron', expr: '0 17 * * 5', tz: 'Asia/Shanghai' },
    sessionTarget: SessionTarget.Main,
    wakeMode: WakeMode.NextHeartbeat,
    payload: { kind: 'agentTurn', message: '整理本周交付与风险' },
    workspaceId: BrowserPreviewFixtureId.WorkspaceMain,
    sessionKey: null,
    state: {
      nextRunAtMs: minutesFromNow(26 * 60),
      lastRunAtMs: hoursAgo(168),
      lastStatus: TaskStatus.Completed,
      lastError: null,
      lastDurationMs: 120_000,
      runningAtMs: null,
      consecutiveErrors: 0,
    },
    createdAt: new Date(hoursAgo(400)).toISOString(),
    updatedAt: new Date(hoursAgo(168)).toISOString(),
  },
];

export const browserPreviewMagpieCatalog = {
  status: {
    state: 'running' as const,
    version: 'preview-1.0',
    enabled: true,
  },
  models: [
    {
      id: 'qwen3-235b-cloud',
      display_name: 'Qwen3 235B（云）',
      context_window: 128_000,
    },
    {
      id: 'deepseek-v3-cloud',
      display_name: 'DeepSeek V3（云）',
      context_window: 64_000,
    },
    {
      id: 'glm-4-plus-cloud',
      display_name: 'GLM-4 Plus（云）',
      context_window: 128_000,
    },
  ],
  defaultModelId: 'qwen3-235b-cloud',
};

export const browserPreviewLocalModels: LlamaCppModel[] = [
  {
    name: 'Qwen2.5-14B-Instruct-Q4_K_M.gguf',
    id: 'local-qwen25-14b',
    model: 'Qwen2.5-14B-Instruct-Q4_K_M',
    path: '/Users/demo/Models/Qwen2.5-14B-Instruct-Q4_K_M.gguf',
    modified_at: new Date(hoursAgo(48)).toISOString(),
    size: 8_900_000_000,
    source: 'local',
    status: 'loaded',
    details: {
      family: 'qwen2',
      parameter_size: '14B',
      quantization_level: 'Q4_K_M',
      context_length: 32768,
    },
    trained_context_length: 32768,
    runtime_context_length: 32768,
    effective_options: { ctxSize: 32768 },
  },
  {
    name: 'Llama-3.1-8B-Instruct-Q5_K_M.gguf',
    id: 'local-llama31-8b',
    model: 'Llama-3.1-8B-Instruct-Q5_K_M',
    path: '/Users/demo/Models/Llama-3.1-8B-Instruct-Q5_K_M.gguf',
    modified_at: new Date(hoursAgo(120)).toISOString(),
    size: 5_700_000_000,
    source: 'local',
    status: 'unloaded',
    details: {
      family: 'llama',
      parameter_size: '8B',
      quantization_level: 'Q5_K_M',
      context_length: 8192,
    },
    trained_context_length: 8192,
  },
  {
    name: 'DeepSeek-Coder-V2-Lite-Instruct-Q4_K_M.gguf',
    id: 'local-deepseek-coder',
    model: 'DeepSeek-Coder-V2-Lite-Instruct-Q4_K_M',
    path: '/Users/demo/Models/DeepSeek-Coder-V2-Lite-Instruct-Q4_K_M.gguf',
    modified_at: new Date(hoursAgo(200)).toISOString(),
    size: 9_100_000_000,
    source: 'local',
    status: 'sleeping',
    details: {
      family: 'deepseek2',
      parameter_size: '16B',
      quantization_level: 'Q4_K_M',
      context_length: 16384,
    },
  },
];

export const browserPreviewLlamaStatus: LlamaCppStatusSnapshot = {
  status: 'running',
  version: 'b5401',
  executablePath: '/Users/demo/Library/Application Support/ZhiYuan/llama-server',
  pid: 42_001,
  managedByApp: true,
  runtimeVersion: 'b5401',
  runtimeBackendId: 'metal',
  checkedAt: new Date(now).toISOString(),
};

export const browserPreviewModelsDir = '/Users/demo/Models';
