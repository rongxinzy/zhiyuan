import { safeStorage } from 'electron';

export interface CredentialKeyValueStore {
  get<T = unknown>(key: string): T | undefined;
  set<T = unknown>(key: string, value: T): void;
  delete(key: string): void;
}

interface EncryptedCredentialPayload {
  version: 1;
  encrypted: string;
}

/**
 * Persists credentials encrypted by the operating system's secure storage.
 * SQLite holds only opaque encrypted blobs, never plaintext secret values.
 */
export class CredentialVault {
  constructor(private readonly store: CredentialKeyValueStore) {}

  getValue<T>(key: string): T | undefined {
    const stored = this.store.get<EncryptedCredentialPayload>(key);
    if (!stored) return undefined;
    if (stored.version !== 1 || typeof stored.encrypted !== 'string') {
      throw new Error(
        'Stored credentials are invalid. Re-enter credentials to repair this integration.',
      );
    }
    this.assertAvailable();
    try {
      const parsed = JSON.parse(
        safeStorage.decryptString(Buffer.from(stored.encrypted, 'base64')),
      ) as unknown;
      if (parsed === null || parsed === undefined) throw new Error('invalid secret payload');
      return parsed as T;
    } catch (error) {
      throw new Error(
        `Stored credentials cannot be read: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  setValue<T>(key: string, value: T): void {
    this.assertAvailable();
    const encrypted = safeStorage.encryptString(JSON.stringify(value)).toString('base64');
    this.store.set<EncryptedCredentialPayload>(key, { version: 1, encrypted });
  }

  deleteValue(key: string): void {
    this.store.delete(key);
  }

  private assertAvailable(): void {
    const secureBackendAvailable =
      safeStorage.isEncryptionAvailable() &&
      (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text');
    if (!secureBackendAvailable) {
      throw new Error('System secure storage is unavailable. Credentials cannot be saved safely.');
    }
  }
}
