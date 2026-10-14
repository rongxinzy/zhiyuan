import fs from 'fs';
import path from 'path';
import { describe, expect, test } from 'vitest';

describe('legacy engine cleanup', () => {
  test('does not retain the disconnected activity tracker or retired execution options', () => {
    expect(fs.existsSync(path.join(__dirname, 'toolActivity.ts'))).toBe(false);
    const options = fs.readFileSync(path.join(__dirname, 'piRuntimeTypes.ts'), 'utf8');
    for (const retired of [
      'attachedSkillIds',
      'codemode',
      'conversationHistory',
      'PiConversationHistoryMessage',
      '_piPromptOverride',
      '_workbenchRunId',
      '_streamStallResume',
      '_queueDelivery',
    ]) {
      expect(options).not.toContain(retired);
    }
  });

  test('does not ship a second renderer-owned chat execution path', () => {
    const rendererRoot = path.resolve(__dirname, '../../../renderer');
    for (const relativePath of [
      'services/api.ts',
      'services/apiConfigResolver.ts',
      'services/chatChatTransport.ts',
      'services/ipcChatTransport.ts',
      'services/coworkChatTransport.ts',
      'services/localThinkingRequest.ts',
      'services/webSearchToolEvents.ts',
      'types/chat.ts',
    ]) {
      expect(fs.existsSync(path.join(rendererRoot, relativePath))).toBe(false);
    }
    const preload = fs.readFileSync(path.resolve(__dirname, '../../preload.ts'), 'utf8');
    expect(preload).not.toContain('ApiIpc.Stream');
    expect(preload).not.toContain('ApiIpc.WebSearch');
  });

  test('package.json no longer depends on the claude agent sdk', () => {
    const packageJsonPath = path.resolve(__dirname, '../../../../package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
      dependencies?: Record<string, string>;
    };

    expect(packageJson.dependencies?.['@anthropic-ai/claude-agent-sdk']).toBeUndefined();
  });
});
