import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { AepProtectedStorage } from '@aep/sdk-node';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { createZhiyuanExtensionRuntime } from './extension-runtime.js';
import type { ZhiyuanEnterpriseHostContext } from './host-contract.js';
import { createZhiyuanAepClient, type ZhiyuanPasswordSessionOptions } from './session/factory.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('Zhiyuan extension runtime', () => {
  test('initializes the enterprise session without provisioning managed skill roots', async () => {
    const root = createTemporaryDirectory();
    writeConfig(root);
    const context = hostContext(root);
    const clientFactory = vi.fn((options: ZhiyuanPasswordSessionOptions) =>
      createZhiyuanAepClient(options),
    );
    const protectedStorage: AepProtectedStorage = {
      read: vi.fn(async () => null),
      write: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
    };

    const runtime = await createZhiyuanExtensionRuntime(context, {
      loadSafeStorage: vi.fn(async () => safeStorageFixture()),
      createProtectedStorage: vi.fn(() => protectedStorage),
      createClient: clientFactory,
    });

    await expect(runtime.session.initialize()).resolves.toEqual({ status: 'signed-out' });
    await runtime.dispose();
    await runtime.dispose();
    expect(
      fs.existsSync(
        path.join(context.paths.userData, 'zhiyuan-enterprise', 'agent-control.sqlite'),
      ),
    ).toBe(false);
    expect(fs.existsSync(path.join(context.paths.userData, 'managed-skills'))).toBe(false);
  });
});

function hostContext(root: string): ZhiyuanEnterpriseHostContext {
  return {
    apiVersion: 1,
    appVersion: '2026.8.0',
    isPackaged: false,
    platform: 'win32',
    paths: {
      resources: path.join(root, 'resources'),
      userData: path.join(root, 'user-data'),
    },
    capabilities: {
      session: null,
      renderer: null,
      settings: null,
      managedProvider: null,
    },
  };
}

function writeConfig(root: string): void {
  const directory = path.join(root, 'resources', 'zhiyuan-enterprise');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, 'config.json'),
    JSON.stringify({
      schemaVersion: 1,
      aepBaseUrl: 'http://127.0.0.1:8080',
      allowInsecureHttp: true,
    }),
  );
}

function safeStorageFixture() {
  return {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'dpapi',
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString('utf8'),
  };
}

function createTemporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-extension-runtime-'));
  temporaryDirectories.push(directory);
  return directory;
}
