// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { WorkDocumentCard } from './WorkDocumentCard';

vi.mock('../../../services/i18n', () => ({ i18nService: { t: (key: string) => key } }));
const getWorkDocument = vi.fn();
const updateWorkDocument = vi.fn();
const unsubscribe = vi.fn();
let changed: (event: { sessionId: string; document: ReturnType<typeof document> }) => void;
const document = (goal = 'Goal A', revision = 1) => ({
  goal,
  agreements: [],
  decisions: [],
  progress: [],
  revision,
  updatedAt: 1,
});

beforeEach(() => {
  getWorkDocument.mockReset().mockResolvedValue({ success: true, data: document() });
  updateWorkDocument.mockReset();
  unsubscribe.mockClear();
  vi.stubGlobal(
    'window',
    Object.assign(window, {
      electron: {
        cowork: {
          getWorkDocument,
          updateWorkDocument,
          onWorkDocumentChanged: (listener: typeof changed) => {
            changed = listener;
            return unsubscribe;
          },
        },
      },
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const open = () => fireEvent.click(screen.getByText('workDocumentTitle'));

test('loads only this work and never writes without an explicit save', async () => {
  render(<WorkDocumentCard sessionId="A" />);
  open();
  await screen.findByText('Goal A');
  expect(getWorkDocument).toHaveBeenCalledWith('A');
  expect(updateWorkDocument).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'edit' }));
  fireEvent.change(screen.getByLabelText('workDocumentField_goal'), {
    target: { value: 'New goal' },
  });
  updateWorkDocument.mockResolvedValue({ success: true, data: document('New goal', 2) });
  fireEvent.click(screen.getByRole('button', { name: 'save' }));
  await screen.findByText('New goal');
  expect(updateWorkDocument).toHaveBeenCalledWith('A', {
    expectedRevision: 1,
    goal: 'New goal',
    agreements: [],
    decisions: [],
    progress: [],
  });
});

test('preserves a dirty draft when native updates arrive and prevents overwriting it', async () => {
  render(<WorkDocumentCard sessionId="A" />);
  open();
  await screen.findByText('Goal A');
  fireEvent.click(screen.getByRole('button', { name: 'edit' }));
  fireEvent.change(screen.getByLabelText('workDocumentField_goal'), {
    target: { value: 'My draft' },
  });
  act(() => changed({ sessionId: 'A', document: document('From a tool', 2) }));
  expect(screen.getByLabelText('workDocumentField_goal')).toHaveValue('My draft');
  expect(screen.getByRole('button', { name: 'save' })).toBeDisabled();
  expect(updateWorkDocument).not.toHaveBeenCalled();
});

test('isolates session switching and discards a late previous load', async () => {
  let finish!: (value: unknown) => void;
  getWorkDocument.mockImplementation((id: string) =>
    id === 'A'
      ? new Promise(resolve => {
          finish = resolve;
        })
      : Promise.resolve({ success: true, data: document('Goal B') }),
  );
  const view = render(<WorkDocumentCard sessionId="A" />);
  view.rerender(<WorkDocumentCard sessionId="B" />);
  open();
  await screen.findByText('Goal B');
  await act(async () => finish({ success: true, data: document('Stale A') }));
  expect(screen.queryByText('Stale A')).not.toBeInTheDocument();
  expect(unsubscribe).toHaveBeenCalled();
});

test('keeps drafts after save errors and blocks duplicate submissions', async () => {
  render(<WorkDocumentCard sessionId="A" />);
  open();
  await screen.findByText('Goal A');
  fireEvent.click(screen.getByRole('button', { name: 'edit' }));
  let finish!: (value: unknown) => void;
  updateWorkDocument.mockImplementation(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'save' }));
  fireEvent.click(screen.getByRole('button', { name: 'save' }));
  expect(updateWorkDocument).toHaveBeenCalledTimes(1);
  await act(async () => finish({ success: false, error: 'Revision conflict' }));
  expect(screen.getByLabelText('workDocumentField_goal')).toHaveValue('Goal A');
  expect(screen.getByRole('alert')).toHaveTextContent('workDocumentSaveFailed');
});

test('reports load errors and supports explicit retry', async () => {
  getWorkDocument.mockRejectedValueOnce(new Error('unavailable'));
  render(<WorkDocumentCard sessionId="A" />);
  open();
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'refresh' }));
  await waitFor(() => expect(screen.getByText('Goal A')).toBeInTheDocument());
});
