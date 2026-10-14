import { beforeEach, expect, test, vi } from 'vitest';

const secureStorage = vi.hoisted(() => ({ available: true }));
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => secureStorage.available,
    getSelectedStorageBackend: () => 'keychain',
    encryptString: (value: string) => Buffer.from(`encrypted:${value}`),
    decryptString: (value: Buffer) => value.toString().replace(/^encrypted:/u, ''),
  },
}));
import { CredentialVault } from './credentialVault';

beforeEach(() => {
  secureStorage.available = true;
});

const createStore = () => {
  const values = new Map<string, unknown>();
  return {
    values,
    get: <T>(key: string) => values.get(key) as T | undefined,
    set: <T>(key: string, value: T) => {
      values.set(key, value);
    },
    delete: (key: string) => {
      values.delete(key);
    },
  };
};

test('keeps local gateway credentials encrypted with their existing key and format', () => {
  const store = createStore();
  const vault = new CredentialVault(store);
  vault.setValue('llamacpp.gateway.credentials', { lanToken: 'test-token' });
  expect(store.values.get('llamacpp.gateway.credentials')).toMatchObject({ version: 1 });
  expect(JSON.stringify(store.values.get('llamacpp.gateway.credentials'))).not.toContain(
    'test-token',
  );
  expect(vault.getValue('llamacpp.gateway.credentials')).toEqual({ lanToken: 'test-token' });
});

test('refuses credential writes when secure storage is unavailable', () => {
  secureStorage.available = false;
  const store = createStore();
  expect(() => new CredentialVault(store).setValue('gateway', 'secret')).toThrow(
    'cannot be saved safely',
  );
  expect(store.values.size).toBe(0);
});
