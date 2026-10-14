import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('./CoworkPromptInput.tsx', import.meta.url)),
  'utf8',
);

test('mounts the shared plain-text editor inside the prompt body', () => {
  expect(source).toContain('<PromptInputTextarea');

  const bodyOpen = source.indexOf('<PromptInputBody');
  const editor = source.indexOf('<PromptInputTextarea');
  const bodyClose = source.indexOf('</PromptInputBody>');
  expect(bodyOpen).toBeGreaterThanOrEqual(0);
  expect(bodyClose).toBeGreaterThan(bodyOpen);
  expect(editor).toBeGreaterThan(bodyOpen);
  expect(editor).toBeLessThan(bodyClose);
  expect(source).not.toContain('overflow-x-auto');
});

test('does not depend on removed capability state or render its input controls', () => {
  expect(source).not.toContain('state.skill');
  expect(source).not.toContain('skillService');
  expect(source).not.toContain('ActiveMcpBadge');
  expect(source).not.toContain('onManageSkills');
  expect(source).not.toContain('onManageConnectors');
});

test('keeps the session permission selector available during an active run', () => {
  const permissionMenuStart = source.indexOf('<PermissionModeMenu');
  const permissionMenuEnd = source.indexOf('/>', permissionMenuStart);
  const permissionMenu = source.slice(permissionMenuStart, permissionMenuEnd);

  expect(permissionMenuStart).toBeGreaterThanOrEqual(0);
  expect(permissionMenu).toContain('onChange={mode => onPermissionModeChange?.(mode)}');
  expect(permissionMenu).toContain('disabled={disabled}');
  expect(permissionMenu).not.toContain('disabled={disabled || isStreaming}');
});

test('keeps model and permission controls reachable in compact toolbars', () => {
  const compactControlsStart = source.indexOf(
    '{isPlusToolbar && (showModelSelector || (isCompactToolbar && isWorkVariant))',
  );
  const compactControls = source.slice(compactControlsStart);

  expect(compactControlsStart).toBeGreaterThanOrEqual(0);
  expect(compactControls).toContain('compact={isCompactToolbar}');
  expect(compactControls).toContain('isCompactToolbar && isWorkVariant');
  expect(compactControls).toContain('<PermissionModeMenu');
  expect(compactControls).toContain('showModelSelector');
});

test('keeps the active expert identity beside permissions without legacy connectors', () => {
  const permissionMenu = source.indexOf('<PermissionModeMenu');
  const expertBadge = source.lastIndexOf('<ActiveExpertBadge');
  expect(expertBadge).toBeGreaterThan(permissionMenu);
  expect(source.slice(expertBadge)).toContain('expertId={selectedExpertIds[0]}');
  expect(source.slice(expertBadge)).toContain('onRemove={() => setSelectedExpertIds([])}');
});

test('seeds the prompt expert chip when opening a new conversation from an expert agent', () => {
  expect(source).toContain('resolveInitialSelectedExpertIds({');
  expect(source).toContain('currentAgentSource: currentAgent?.source');
});

test('clears the prompt expert chip on new-chat focus-input reset', () => {
  expect(source).toContain('clearExperts?: boolean');
  expect(source).toContain('detail?.clearExperts === true');
  expect(source).not.toContain('detail?.clearExperts === true || shouldClear');
  expect(source).toContain('setSelectedExpertIds([])');
});

test('keeps streaming controls gated without obscuring the prompt', () => {
  expect(source).not.toContain('bg-input/50 dark:bg-input/80');
  expect(source).not.toContain("className={isStreaming ? 'relative z-20' : undefined}");
  expect(source).toContain('disabled={disabled || isStreaming || isAddingFile}');
  expect(source).toContain("status={isStreaming ? 'streaming' : 'ready'}");
  expect(source).toContain('onStop={isStreaming ? onStop : undefined}');
});

test('keeps text editing mounted while a target session context is pending', () => {
  expect(source).toContain('disabled={disabled}');
  expect(source).toContain('inert={sessionContextPending ? true : undefined}');
  expect(source).toContain('disabled={sessionContextPending}');
  expect(source).toContain('sessionContextPending ||');
});

test('allows an empty amendment only while an explicit task resume context is active', () => {
  expect(source).toContain('!trimmedValue && attachments.length === 0 && !resumeTaskActive');
  expect(source).toContain('<ResumeTaskContextBadge onCancel={onCancelTaskResume} />');
});
