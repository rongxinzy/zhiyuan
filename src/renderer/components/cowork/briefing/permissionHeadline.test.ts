import { expect, test } from 'vitest';

import { CoworkPermissionOrigin } from '../../../../shared/cowork/constants';
import type { CoworkPermissionRequest } from '../../../types/cowork';
import { buildPermissionBriefingHeadline } from './permissionHeadline';

const permission = (overrides: Partial<CoworkPermissionRequest> = {}): CoworkPermissionRequest => ({
  origin: CoworkPermissionOrigin.PiWorkbench,
  sessionId: 'session',
  requestId: 'req',
  toolName: 'bash',
  toolInput: {},
  ...overrides,
});

test('describes multi-target deletes with a count-first headline', () => {
  const headline = buildPermissionBriefingHeadline(
    permission({
      toolInput: {
        command: 'rm -rf dist/old-build-1 dist/old-build-2 dist/old-build-3',
      },
    }),
  );
  expect(headline).toEqual({
    i18nKey: 'briefingDecisionRemoveMany',
    params: { count: '3' },
  });
});

test('describes git push approvals with the remote target', () => {
  const headline = buildPermissionBriefingHeadline(
    permission({
      toolInput: { command: 'git push origin cursor/phase1-sidebar-slimming-fb95' },
    }),
  );
  expect(headline.i18nKey).toBe('briefingDecisionGitPush');
  expect(headline.params.target).toContain('cursor/phase1-sidebar-slimming-fb95');
});

test('describes write approvals with the destination path', () => {
  const headline = buildPermissionBriefingHeadline(
    permission({
      toolName: 'write',
      toolInput: { path: 'docs/release-notes.md' },
    }),
  );
  expect(headline).toMatchObject({
    i18nKey: 'briefingDecisionWrite',
    params: { path: 'docs/release-notes.md' },
  });
});
