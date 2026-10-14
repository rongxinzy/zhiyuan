// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';
import { i18nService } from '../../services/i18n';
import { CoworkSessionLayout } from './CoworkSessionLayout';

vi.mock('../icons/ArtifactPanelAnimatedToggleIcon', () => ({
  ArtifactPanelAnimatedToggleIcon: () => <span />,
}));
vi.mock('../icons/SidebarAnimatedMessageCirclePlusIcon', () => ({
  SidebarAnimatedMessageCirclePlusIcon: () => <span />,
}));
vi.mock('../window/WindowTitleBar', () => ({ default: () => <div /> }));

function Conversation() {
  const [value, setValue] = useState('');
  const [open, setOpen] = useState(false);
  return (
    <CoworkSessionLayout
      title="Conversation"
      isSessionSwitching={false}
      isArtifactPanelOpen={open}
      onToggleArtifactPanel={() => setOpen(current => !current)}
    >
      <input
        aria-label="conversation draft"
        value={value}
        onChange={event => setValue(event.target.value)}
      />
      <span>{open ? 'preview open' : 'preview closed'}</span>
    </CoworkSessionLayout>
  );
}
beforeEach(() => {
  i18nService.setLanguage('zh', { persist: false });
  (window as unknown as { electron: unknown }).electron = { platform: 'darwin' };
});

test('keeps conversation drafts and artifact access without a separate audit route', async () => {
  const user = userEvent.setup();
  render(<Conversation />);
  expect(screen.getByRole('heading', { name: 'Conversation' })).toBeVisible();
  expect(screen.queryByRole('tab')).toBeNull();
  await user.type(screen.getByRole('textbox', { name: 'conversation draft' }), 'Keep this draft');
  await user.click(screen.getByRole('button', { name: i18nService.t('artifactPanelToggle') }));
  expect(screen.getByText('preview open')).toBeVisible();
  expect(screen.getByRole('textbox', { name: 'conversation draft' })).toHaveValue(
    'Keep this draft',
  );
});

test('disables artifact switching while the next session is loading', () => {
  render(
    <CoworkSessionLayout
      title="Loading"
      isSessionSwitching
      isArtifactPanelOpen={false}
      onToggleArtifactPanel={vi.fn()}
    >
      <div>Conversation body</div>
    </CoworkSessionLayout>,
  );
  expect(screen.getByRole('button', { name: i18nService.t('artifactPanelToggle') })).toBeDisabled();
  expect(screen.getByText('Conversation body')).toBeVisible();
});
