// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { TabsContent } from '@shared/components/ui/tabs';
import { CoworkSessionLayout } from './CoworkSessionLayout';
import { WorkDocumentCard } from './durable/WorkDocumentCard';
import type { WorkSceneSection } from './scene/WorkSceneResults';

vi.mock('../../services/i18n', () => ({ i18nService: { t: (key: string) => key } }));
vi.mock('../icons/ArtifactPanelAnimatedToggleIcon', () => ({
  ArtifactPanelAnimatedToggleIcon: () => <span />,
}));
vi.mock('../icons/SidebarAnimatedMessageCirclePlusIcon', () => ({
  SidebarAnimatedMessageCirclePlusIcon: () => <span />,
}));
vi.mock('../window/WindowTitleBar', () => ({ default: () => <div /> }));
const getWorkDocument = vi.fn(),
  updateWorkDocument = vi.fn(),
  resumeDurableWork = vi.fn(),
  onSnapshot = vi.fn();
const original = {
  goal: 'Saved goal',
  agreements: [],
  decisions: [],
  progress: [],
  revision: 1,
  updatedAt: 1,
};
beforeEach(() => {
  vi.clearAllMocks();
  getWorkDocument.mockResolvedValue({ success: true, data: original });
  Object.defineProperty(window, 'electron', {
    configurable: true,
    value: {
      platform: 'darwin',
      cowork: {
        getWorkDocument,
        updateWorkDocument,
        resumeDurableWork,
        onWorkDocumentChanged: () => () => {},
      },
    },
  });
});
afterEach(cleanup);
function Scene({ switching = false }: { switching?: boolean }) {
  const [section, setSection] = useState<WorkSceneSection>('results');
  const [draft, setDraft] = useState('');
  return (
    <CoworkSessionLayout
      title="Current work"
      section={section}
      onSectionChange={setSection}
      isSessionSwitching={switching}
      isArtifactPanelOpen={false}
      onToggleArtifactPanel={vi.fn()}
    >
      <TabsContent value="results" keepMounted>
        <p>Saved result</p>
      </TabsContent>
      <TabsContent value="conversation" keepMounted>
        <textarea
          aria-label="Conversation draft"
          value={draft}
          onChange={event => setDraft(event.target.value)}
        />
      </TabsContent>
      <TabsContent value="document" keepMounted>
        <WorkDocumentCard sessionId="work-a" expanded onSnapshot={onSnapshot} />
      </TabsContent>
    </CoworkSessionLayout>
  );
}

test('real scene tabs preserve conversation and document editing drafts without executing or saving on navigation', async () => {
  const user = userEvent.setup();
  render(<Scene />);
  expect(screen.getByRole('tab', { name: 'workSceneResults' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await user.click(screen.getByRole('tab', { name: 'workSceneConversation' }));
  const draft = screen.getByRole('textbox', { name: 'Conversation draft' });
  await user.type(draft, 'Unsent instruction');
  await user.click(screen.getByRole('tab', { name: 'workSceneDocument' }));
  await screen.findByText('Saved goal');
  await user.click(screen.getByRole('button', { name: 'edit' }));
  const goal = screen.getByLabelText('workDocumentField_goal');
  await user.clear(goal);
  await user.type(goal, 'Unsaved goal');
  await user.click(screen.getByRole('tab', { name: 'workSceneResults' }));
  expect(draft).toBeInTheDocument();
  expect(goal).toBeInTheDocument();
  await user.click(screen.getByRole('tab', { name: 'workSceneConversation' }));
  expect(draft).toHaveValue('Unsent instruction');
  await user.click(screen.getByRole('tab', { name: 'workSceneDocument' }));
  expect(goal).toHaveValue('Unsaved goal');
  expect(getWorkDocument).toHaveBeenCalledExactlyOnceWith('work-a');
  expect(updateWorkDocument).not.toHaveBeenCalled();
  expect(resumeDurableWork).not.toHaveBeenCalled();
  await waitFor(() => expect(onSnapshot).toHaveBeenCalledWith(original));
});

test('loading another work disables every scene tab and the artifact action', async () => {
  const user = userEvent.setup();
  render(<Scene switching />);
  for (const tab of screen.getAllByRole('tab'))
    expect(tab).toHaveAttribute('aria-disabled', 'true');
  await user.click(screen.getByRole('tab', { name: 'workSceneDocument' }));
  expect(screen.getByRole('tab', { name: 'workSceneResults' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(screen.getByRole('button', { name: 'artifactPanelToggle' })).toBeDisabled();
  expect(updateWorkDocument).not.toHaveBeenCalled();
  expect(resumeDurableWork).not.toHaveBeenCalled();
});
