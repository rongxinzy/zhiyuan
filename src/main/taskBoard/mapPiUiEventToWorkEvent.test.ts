import { expect, test } from 'vitest';

import { PiUiEventType } from '../../shared/cowork/piUiEvent';
import { TaskBoardWorkEventKind } from '../../shared/taskBoard/constants';
import { mapPiUiEventToWorkEvent } from './mapPiUiEventToWorkEvent';

const base = {
  protocolVersion: 1 as const,
  eventId: 'e1',
  sequence: 1,
  emittedAt: 1000,
  sessionId: 's1',
};

test('maps permission requests to needs confirmation work events', () => {
  const mapped = mapPiUiEventToWorkEvent({
    ...base,
    type: PiUiEventType.PermissionRequest,
    sessionId: 's1',
    request: {
      requestId: 'r1',
      toolName: 'bash',
      toolInput: {},
    },
  });
  expect(mapped?.kind).toBe(TaskBoardWorkEventKind.NeedsConfirmation);
  expect(mapped?.threadKey).toBe('s1');
});
