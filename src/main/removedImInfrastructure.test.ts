import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';

const source = (relativePath: string): string =>
  fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

test('does not register external messaging or account setup operations', () => {
  const main = source('src/main/main.ts');
  expect(main).not.toMatch(/CcConnect|ccConnect|imGatewayManager|IMStore|WeixinInstallIpc/u);
  expect(main).not.toMatch(/['"](?:im|feishu|dingtalk|weixin):/u);
  expect(main).toContain('registerScheduledTaskHandlers({ getCronJobService })');
  expect(main).toContain('new LocalSchedulerRuntime(');
});

test('does not expose messaging, remote session ownership, or channel delivery in preload', () => {
  const preload = source('src/main/preload.ts');
  expect(preload).not.toMatch(/\b(?:im|feishu|dingtalk):\s*\{/u);
  expect(preload).not.toMatch(
    /ImIpc|ImInstanceIpc|WeixinInstallIpc|remoteManaged|ListDeliveries|ListChannels|ListChannelConversations/u,
  );
  expect(preload).toContain('scheduledTasks: {');
  expect(preload).toContain('cowork: {');
});

test('removes messaging transport implementation without deleting stored user data', () => {
  expect(
    fs.existsSync(path.join(process.cwd(), 'src/main/im')) &&
      fs.readdirSync(path.join(process.cwd(), 'src/main/im')).some(name => name.endsWith('.ts')),
  ).toBe(false);
  expect(source('src/main/main.ts')).not.toMatch(/DROP TABLE.*(?:im_|channel_)/iu);
});
