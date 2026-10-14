// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from 'vitest';

import { coworkQueueService } from './coworkQueue';

interface EnqueuePayload {
  requestId: string;
  sessionId: string;
  text: string;
  imageAttachments?: unknown;
  fileAttachments?: unknown;
}

const enqueuePendingMessage = vi.hoisted(() =>
  vi.fn(async (_options: EnqueuePayload) => ({ success: true })),
);

beforeEach(() => {
  enqueuePendingMessage.mockClear();
  (window as unknown as { electron: unknown }).electron = {
    cowork: { enqueuePendingMessage },
  };
});

test('forwards both attachment kinds without a retired capability selection', async () => {
  await coworkQueueService.enqueue(
    'session-1',
    'review this',
    [{ name: 'screen.png', mimeType: 'image/png', base64Data: 'a' }],
    [{ name: 'brief.docx', path: '/tmp/brief.docx', extension: 'DOCX' }],
  );

  expect(enqueuePendingMessage).toHaveBeenCalledWith({
    requestId: expect.any(String),
    sessionId: 'session-1',
    text: 'review this',
    imageAttachments: [{ name: 'screen.png', mimeType: 'image/png', base64Data: 'a' }],
    fileAttachments: [{ name: 'brief.docx', path: '/tmp/brief.docx', extension: 'DOCX' }],
  });
});

test('forwards an input that attached nothing as empty fields', async () => {
  await coworkQueueService.enqueue('session-1', 'plain follow-up');

  expect(enqueuePendingMessage).toHaveBeenCalledWith({
    requestId: expect.any(String),
    sessionId: 'session-1',
    text: 'plain follow-up',
    imageAttachments: undefined,
    fileAttachments: undefined,
  });
});

test('gives separate submissions different native request identities', async () => {
  await coworkQueueService.enqueue('session-1', 'same text');
  await coworkQueueService.enqueue('session-1', 'same text');
  const [first, second] = enqueuePendingMessage.mock.calls;
  expect(first[0].requestId).toBeTruthy();
  expect(second[0].requestId).not.toBe(first[0].requestId);
});
