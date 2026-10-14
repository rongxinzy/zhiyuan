// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { CoworkMessage } from '../../../types/cowork';
import type { Artifact } from '../../../types/artifact';
import { latestSavedReply, WorkSceneResults } from './WorkSceneResults';

vi.mock('../../../services/i18n', () => ({ i18nService: { t: (key: string) => key } }));
vi.mock('../../MarkdownContent', () => ({
  default: ({ content }: { content: string }) => <div data-testid="saved-reply">{content}</div>,
}));
afterEach(cleanup);
const message = (
  id: string,
  content: string,
  extra: Partial<CoworkMessage> = {},
): CoworkMessage => ({ id, type: 'assistant', content, timestamp: 1, ...extra });
const callbacks = () => ({
  onConversation: vi.fn(),
  onDocument: vi.fn(),
  onArtifact: vi.fn(),
  onStop: vi.fn(),
});

test('latest result is the newest saved assistant reply, excluding thinking, streaming, error and non-answer records', () => {
  const saved = message('saved', 'Actual answer');
  const records = [
    message('older', 'Older answer'),
    saved,
    message('thinking', 'Private thought', { metadata: { isThinking: true } }),
    message('streaming', 'Unfinished answer', { metadata: { isStreaming: true } }),
    message('error', 'Failure text', { metadata: { isError: true } }),
    message('tool', 'Tool output', { type: 'tool_result' }),
    message('user', 'User request', { type: 'user' }),
    message('blank', '  '),
  ];
  expect(latestSavedReply(records)).toBe(saved);
  const actions = callbacks();
  render(
    <WorkSceneResults
      messages={records}
      artifacts={[]}
      document={null}
      running={false}
      {...actions}
    />,
  );
  expect(screen.getByTestId('saved-reply')).toHaveTextContent('Actual answer');
  for (const text of ['Private thought', 'Unfinished answer', 'Failure text', 'Tool output'])
    expect(screen.queryByText(text)).toBeNull();
  expect(Object.values(actions).every(action => action.mock.calls.length === 0)).toBe(true);
});

test('running work is not presented as completed and correction or stop requires an explicit click', () => {
  const actions = callbacks();
  render(
    <WorkSceneResults
      messages={[message('saved', 'Saved partial result')]}
      artifacts={[]}
      document={null}
      running
      {...actions}
    />,
  );
  expect(screen.getByRole('status')).toHaveTextContent('workSceneRunning');
  expect(screen.queryByText(/completed|已完成/)).toBeNull();
  expect(actions.onStop).not.toHaveBeenCalled();
  expect(actions.onConversation).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'workSceneCorrect' }));
  expect(actions.onConversation).toHaveBeenCalledOnce();
  expect(actions.onStop).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'workSceneStop' }));
  expect(actions.onStop).toHaveBeenCalledOnce();
});

test('long saved output and artifact lists are bounded while the full response and every artifact stay reachable', () => {
  const actions = callbacks();
  const text = 'x'.repeat(9000);
  const artifacts = Array.from(
    { length: 14 },
    (_, i) => ({ id: `artifact-${i}`, title: `Artifact ${i}` }) as Artifact,
  );
  render(
    <WorkSceneResults
      messages={[message('long', text)]}
      artifacts={artifacts}
      document={{
        goal: 'g'.repeat(1200),
        agreements: [],
        decisions: [],
        progress: ['old', 'one', 'two', 'p'.repeat(700)],
        revision: 1,
        updatedAt: 1,
      }}
      running={false}
      {...actions}
    />,
  );
  expect(screen.getByTestId('saved-reply').textContent?.length).toBe(8000);
  fireEvent.click(screen.getByRole('button', { name: 'workSceneFullReply' }));
  expect(actions.onConversation).toHaveBeenCalledOnce();
  const section = screen.getByRole('region', { name: 'workSceneArtifacts' });
  expect(within(section).getAllByRole('listitem')).toHaveLength(6);
  fireEvent.click(within(section).getByRole('button', { name: 'workSceneMore' }));
  expect(within(section).getAllByRole('listitem')).toHaveLength(12);
  fireEvent.click(within(section).getByRole('button', { name: 'workSceneMore' }));
  expect(within(section).getAllByRole('listitem')).toHaveLength(14);
  fireEvent.click(within(section).getByRole('button', { name: 'Artifact 13' }));
  expect(actions.onArtifact).toHaveBeenCalledWith(artifacts[13]);
  expect(screen.queryByText('old')).toBeNull();
  expect(screen.getByText('g'.repeat(1000))).toBeTruthy();
  expect(screen.getByText('p'.repeat(500))).toBeTruthy();
});

test('no saved result is an honest empty state, without a stop action on idle work', () => {
  const actions = callbacks();
  render(
    <WorkSceneResults
      messages={[message('stream', 'Partial', { metadata: { isStreaming: true } })]}
      artifacts={[]}
      document={null}
      running={false}
      {...actions}
    />,
  );
  expect(screen.getByText('workSceneNoOutput')).toBeTruthy();
  expect(screen.getByText('workSceneNoArtifacts')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'workSceneStop' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'workSceneDocument' }));
  expect(actions.onDocument).toHaveBeenCalledOnce();
});

test('a failed run retains its saved output but clearly reports the failure without resuming', () => {
  const actions = callbacks();
  render(
    <WorkSceneResults
      messages={[message('saved', 'Earlier saved output')]}
      artifacts={[]}
      document={null}
      running={false}
      failed
      {...actions}
    />,
  );
  expect(screen.getByRole('alert')).toHaveTextContent('workSceneFailed');
  expect(screen.getByTestId('saved-reply')).toHaveTextContent('Earlier saved output');
  expect(actions.onConversation).not.toHaveBeenCalled();
  expect(actions.onStop).not.toHaveBeenCalled();
});
