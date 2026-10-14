// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, expect, test, vi } from 'vitest';

import TaskFormBody from './TaskFormBody';

afterEach(cleanup);

test('keeps workspace selection without a shared-session execution target', () => {
  render(
    createElement(TaskFormBody, {
      mode: 'create',
      name: '',
      modelId: '',
      workspaceId: 'workspace-1',
      payloadText: '',
      errors: {},
      modelOptions: [],
      workspaceOptions: [{ value: 'workspace-1', label: 'Main workspace' }],
      scheduleControl: null,
      onNameChange: vi.fn(),
      onModelChange: vi.fn(),
      onWorkspaceChange: vi.fn(),
      onPayloadTextChange: vi.fn(),
    }),
  );

  const triggers = screen.getAllByRole('combobox');
  expect(triggers.at(-1)).toHaveTextContent('Main workspace');
  expect(triggers).toHaveLength(2);
});
