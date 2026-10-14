// @vitest-environment jsdom
import { createElement } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import type { HistoryApi } from '@shared/history';
import { HistoryBrowser } from './HistoryBrowser';
import { historyTranslations } from '../../services/historyTranslations';

vi.mock('../PageHeader', () => ({
  default: ({ title }: { title: string }) => createElement('h1', null, title),
}));
vi.mock('../../services/i18n', () => ({
  i18nService: {
    t: (key: string) => historyTranslations.zh[key as keyof typeof historyTranslations.zh] ?? key,
    subscribe: () => () => {},
    getLanguage: () => 'zh',
  },
}));
vi.mock('@shared/components/ai-elements/message', () => ({
  Message: ({ children }: { children: React.ReactNode }) => createElement('div', null, children),
  MessageContent: ({ children }: { children: React.ReactNode }) =>
    createElement('div', null, children),
  MessageResponse: ({ children }: { children: React.ReactNode }) =>
    createElement('div', null, children),
}));

function fixture() {
  const locator = { source: 'coding' as const, id: 'lane-a' };
  const openTarget = { roomId: 'room-a', laneId: 'lane-a' };
  const api: HistoryApi = {
    list: vi.fn<HistoryApi['list']>(async () => ({
      success: true,
      data: {
        items: [
          {
            locator,
            openTarget,
            title: '项目历史',
            workspace: '/work',
            updatedAt: 1000,
            backend: 'coding',
            readOnly: false,
          },
        ],
      },
    })),
    search: vi.fn<HistoryApi['search']>(async () => ({
      success: true,
      data: {
        items: [
          {
            locator,
            openTarget,
            title: '中文命中',
            entryId: 'entry-a',
            messageId: 'message-a',
            content: '中文搜索片段',
            timestamp: 1000,
          },
        ],
      },
    })),
    readPage: vi.fn<HistoryApi['readPage']>(async () => ({
      success: true,
      data: {
        items: [
          {
            id: 'message-a',
            entryId: 'entry-a',
            type: 'assistant',
            content: '历史消息正文',
            timestamp: 1000,
            metadata: { fileAttachments: [{ name: 'report.pdf', mimeType: 'application/pdf' }] },
          },
        ],
      },
    })),
    rebuildIndex: vi.fn(),
  };
  return { api, locator, openTarget };
}

test('search preserves two-character Chinese and opens exact read-only anchor', async () => {
  const { api, locator, openTarget } = fixture();
  const open = vi.fn();
  render(createElement(HistoryBrowser, { api, onClose: vi.fn(), onOpenConversation: open }));
  await screen.findByText('项目历史');
  fireEvent.change(screen.getByRole('textbox', { name: '搜索历史消息' }), {
    target: { value: '中文' },
  });
  fireEvent.click(screen.getByRole('button', { name: '搜索' }));
  await screen.findByText('中文命中');
  expect(api.search).toHaveBeenCalledWith({ query: '中文', cursor: undefined, limit: 30 });
  fireEvent.click(screen.getByRole('button', { name: /中文命中/ }));
  await screen.findByText('历史消息正文');
  expect(api.readPage).toHaveBeenCalledWith({
    locator,
    anchor: 'entry-a',
    cursor: undefined,
    limit: 30,
  });
  expect(screen.getByText('report.pdf')).toBeTruthy();
  expect(open).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '打开原会话' }));
  expect(open).toHaveBeenCalledWith(locator, openTarget);
  fireEvent.click(screen.getByRole('button', { name: '返回历史列表' }));
  await screen.findByText('中文命中');
  expect(screen.getByRole('textbox')).toHaveValue('中文');
});

test('empty search offers a way back and failure offers retry', async () => {
  const { api } = fixture();
  api.search = vi.fn<HistoryApi['search']>(async () => ({ success: true, data: { items: [] } }));
  render(createElement(HistoryBrowser, { api, onClose: vi.fn() }));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'missing' } });
  fireEvent.click(screen.getByRole('button', { name: '搜索' }));
  await screen.findByText('没有找到匹配的消息。试试其他关键词，或返回全部历史。');
  api.list = vi.fn<HistoryApi['list']>(async () => ({
    success: false,
    error: '/private/path/internal stack',
  }));
  fireEvent.click(screen.getByRole('button', { name: '全部历史' }));
  await screen.findByRole('alert');
  expect(screen.queryByText('/private/path/internal stack')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
});
