// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { CodingEventKind, CodingLaneStatus, type CodingEvent } from '../../../shared/codingAgent';
import { CodingTaskOverview } from './CodingTaskOverview';
import { projectCodingEvents } from './codingEventProjection';
import { selectCodingTaskOverview } from './codingTaskOverview';

vi.mock('../../services/i18n', () => ({ i18nService: { t: (key: string) => key } }));
afterEach(cleanup);
const event = (
  sequence: number,
  kind: CodingEvent['kind'],
  payload: CodingEvent['payload'],
): CodingEvent => ({
  id: `event-${sequence}`,
  laneId: 'lane',
  sequence,
  kind,
  payload,
  createdAt: sequence,
});
const completed = (text = 'Saved agent response') => [
  event(1, CodingEventKind.Message, { role: 'user', content: 'Fix the login form' }),
  event(2, CodingEventKind.Reasoning, { content: 'Private reasoning' }),
  event(3, CodingEventKind.MessageDelta, { role: 'assistant', messageId: 'reply', content: text }),
  event(4, CodingEventKind.TurnComplete, {}),
];
const actions = () => ({ onReview: vi.fn(), onFiles: vi.fn(), onOutput: vi.fn() });

test('overview reuses real projected user request and settled reply, never reasoning or streaming text', () => {
  const turns = projectCodingEvents([
    ...completed(),
    event(5, CodingEventKind.Message, { role: 'user', content: 'Now check keyboard navigation' }),
    event(6, CodingEventKind.MessageDelta, {
      role: 'assistant',
      messageId: 'pending',
      content: 'Unfinished answer',
    }),
  ]);
  expect(selectCodingTaskOverview(turns)).toMatchObject({
    request: 'Now check keyboard navigation',
    result: 'Saved agent response',
    previousTurn: true,
  });
  expect(selectCodingTaskOverview(projectCodingEvents(completed().slice(0, -1))).result).toBe('');
});

test('a failed or cancelled latest turn does not reuse an older successful answer', () => {
  for (const kind of [CodingEventKind.TurnFailed, CodingEventKind.TurnCancelled]) {
    const turns = projectCodingEvents([
      ...completed(),
      event(5, CodingEventKind.Message, { role: 'user', content: 'Second task' }),
      event(6, kind, { error: 'Actual failure' }),
    ]);
    const overview = selectCodingTaskOverview(turns);
    expect(overview.result).toBe('');
    expect(overview.previousTurn).toBe(false);
  }
});

test('shows task and source, with accessible code/file/output actions that do nothing until clicked', async () => {
  const user = userEvent.setup();
  const callbacks = actions();
  render(
    <CodingTaskOverview
      sourceRoot="/projects/real-app"
      status={CodingLaneStatus.Running}
      turns={projectCodingEvents(completed().slice(0, -1))}
      hasOutput
      {...callbacks}
    />,
  );
  expect(screen.getByText('Fix the login form')).toBeTruthy();
  expect(screen.getByText('/projects/real-app')).toHaveAttribute('title', '/projects/real-app');
  expect(screen.getByText('codingWorkRunning')).toBeTruthy();
  expect(screen.queryByText('codingWorkEnded')).toBeNull();
  for (const callback of Object.values(callbacks)) expect(callback).not.toHaveBeenCalled();
  const review = screen.getByRole('button', { name: 'codingWorkDiff' });
  review.focus();
  await user.keyboard('{Enter}');
  expect(callbacks.onReview).toHaveBeenCalledOnce();
  await user.click(screen.getByRole('button', { name: 'codingWorkFiles' }));
  expect(callbacks.onFiles).toHaveBeenCalledOnce();
  await user.click(screen.getByRole('button', { name: 'codingWorkOutput' }));
  expect(callbacks.onOutput).toHaveBeenCalledOnce();
});

test('labels older results during a new run and bounds expanded output without changing a sibling composer draft', async () => {
  const user = userEvent.setup();
  const text = 'x'.repeat(4000);
  const turns = projectCodingEvents([
    ...completed(text),
    event(5, CodingEventKind.Message, { role: 'user', content: 'New task' }),
  ]);
  function Harness() {
    const [draft, setDraft] = useState('Keep this instruction');
    return (
      <>
        <CodingTaskOverview
          sourceRoot="/project"
          status={CodingLaneStatus.Running}
          turns={turns}
          hasOutput={false}
          {...actions()}
        />
        <textarea aria-label="Draft" value={draft} onChange={e => setDraft(e.target.value)} />
      </>
    );
  }
  render(<Harness />);
  expect(screen.getByRole('button', { name: 'codingWorkOutput' })).toBeDisabled();
  const trigger = screen.getByRole('button', { name: 'codingWorkPreviousResult' });
  await user.click(trigger);
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByText('x'.repeat(1200))).toBeTruthy();
  expect(screen.queryByText(text)).toBeNull();
  expect(screen.getByText('codingWorkResultScope')).toBeTruthy();
  expect(screen.getByText('codingWorkResultTruncated')).toBeTruthy();
  await user.click(trigger);
  expect(screen.getByRole('textbox', { name: 'Draft' })).toHaveValue('Keep this instruction');
});

test('draft and no-result states do not fabricate a task, result or runnable terminal', async () => {
  const user = userEvent.setup();
  const callbacks = actions();
  render(
    <CodingTaskOverview
      sourceRoot="/project"
      status={null}
      turns={[]}
      hasOutput={false}
      {...callbacks}
    />,
  );
  expect(screen.getByText('codingWorkDraft')).toBeTruthy();
  expect(screen.getByText('codingWorkNewTask')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'codingWorkLatestResult' }));
  expect(screen.getByText('codingWorkNoResult')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'codingWorkOutput' }));
  expect(callbacks.onOutput).not.toHaveBeenCalled();
});
