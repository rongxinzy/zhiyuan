import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const electronPaths = vi.hoisted(() => ({ userData: '' }));

vi.mock('electron', () => ({
  app: { getPath: () => electronPaths.userData },
}));

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enterprise-config-'));
  electronPaths.userData = path.join(tempDir, 'userData');
  fs.mkdirSync(electronPaths.userData, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

test('ignores removed skill and MCP packages without touching existing user files', async () => {
  const configDir = path.join(electronPaths.userData, 'enterprise-config');
  const skillDir = path.join(configDir, 'skills', 'review');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Review');
  fs.writeFileSync(
    path.join(configDir, 'manifest.json'),
    JSON.stringify({
      version: '2.0.0',
      name: 'Current package',
      sync: { skills: true, agents: false, mcp: false },
    }),
  );
  const existingSkill = path.join(electronPaths.userData, 'SKILLs', 'existing', 'SKILL.md');
  fs.mkdirSync(path.dirname(existingSkill), { recursive: true });
  fs.writeFileSync(existingSkill, '# Keep user data');
  fs.mkdirSync(path.join(configDir, 'mcp'), { recursive: true });
  fs.writeFileSync(path.join(configDir, 'mcp', 'servers.json'), '{ invalid removed configuration');

  const values = new Map<string, unknown>();
  const store = {
    get: (key: string) => values.get(key),
    set: (key: string, value: unknown) => values.set(key, value),
  };
  const { syncEnterpriseConfig } = await import('./enterpriseConfigSync');
  const manifest = syncEnterpriseConfig(configDir, store as never, () =>
    path.join(tempDir, 'workspace'),
  );

  expect(manifest?.version).toBe('2.0.0');
  expect(fs.existsSync(path.join(electronPaths.userData, 'SKILLs', 'review', 'SKILL.md'))).toBe(
    false,
  );
  expect(fs.readFileSync(existingSkill, 'utf8')).toBe('# Keep user data');
  expect(values.has('skills_state')).toBe(false);
});

test('does not fall back to a legacy agent workspace', async () => {
  const configDir = path.join(electronPaths.userData, 'enterprise-config');
  fs.mkdirSync(path.join(configDir, 'agents'), { recursive: true });
  fs.writeFileSync(path.join(configDir, 'agents', 'AGENTS.md'), '# Enterprise');
  fs.writeFileSync(
    path.join(configDir, 'manifest.json'),
    JSON.stringify({
      version: '2.0.0',
      name: 'Current package',
      sync: { skills: false, agents: true, mcp: false },
    }),
  );
  const store = { get: () => undefined, set: () => undefined };
  const { syncEnterpriseConfig } = await import('./enterpriseConfigSync');
  syncEnterpriseConfig(configDir, store as never, () => undefined);

  expect(fs.existsSync(path.join(tempDir, '.openclaw'))).toBe(false);
});
