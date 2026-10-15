import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, truncateSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const { appendPayload, inspectSetup, hashFile, MAX_SETUP_BYTES } = require('./sfx-format.cjs');
const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'zhiyuan-sfx-'));
  roots.push(root);
  const shell = path.join(root, 'shell.exe');
  const zip = path.join(root, 'payload.zip');
  const output = path.join(root, 'setup.exe');
  const pe = Buffer.alloc(128);
  pe.write('MZ');
  pe.writeUInt32LE(64, 60);
  pe.writeUInt32LE(0x4550, 64);
  pe.writeUInt16LE(0x8664, 68);
  writeFileSync(shell, pe);
  writeFileSync(zip, Buffer.concat([Buffer.from('PK\x05\x06'), Buffer.alloc(18)]));
  return { shell, zip, output };
}
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
describe('final single-file setup framing and budget', () => {
  it('streams the shell, ZIP and length footer without modifying either input', () => {
    const f = fixture();
    const shell = readFileSync(f.shell);
    const zip = readFileSync(f.zip);
    expect(appendPayload(f.shell, f.zip, f.output)).toEqual({
      kind: 'webview2-single-file-setup',
      architecture: 'x64',
      installerBytes: 162,
      shellBytes: 128,
      payloadBytes: 22,
    });
    expect(readFileSync(f.output).subarray(0, 128)).toEqual(shell);
    expect(readFileSync(f.output).subarray(128, 150)).toEqual(zip);
    expect(readFileSync(f.shell)).toEqual(shell);
    expect(readFileSync(f.zip)).toEqual(zip);
    expect(hashFile(f.output)).toMatch(/^[a-f0-9]{64}$/);
  });
  it('refuses overwriting either packaging input', () => {
    const f = fixture();
    expect(() => appendPayload(f.shell, f.zip, f.shell)).toThrow('overwrite');
    expect(() => appendPayload(f.shell, f.zip, f.zip)).toThrow('overwrite');
  });
  it('rejects a bare executable and corrupt payload boundaries', () => {
    const f = fixture();
    expect(() => inspectSetup(f.shell)).toThrow();
    appendPayload(f.shell, f.zip, f.output);
    const content = readFileSync(f.output);
    content.writeBigUInt64LE(1000000n, content.length - 12);
    writeFileSync(f.output, content);
    expect(() => inspectSetup(f.output)).toThrow('payload length');
    content.writeBigUInt64LE(22n, content.length - 12);
    content.write('XX', 128);
    writeFileSync(f.output, content);
    expect(() => inspectSetup(f.output)).toThrow('ZIP');
  });
  it('enforces the final executable budget before copying payload bytes', () => {
    const f = fixture();
    truncateSync(f.zip, MAX_SETUP_BYTES);
    expect(() => appendPayload(f.shell, f.zip, f.output)).toThrow('450 MiB');
    expect(() => inspectSetup(f.zip)).toThrow('Windows executable');
  });
});

describe('Windows distribution entry points', () => {
  it('ordinary setup builds cannot omit the final shell and updater NSIS stays explicit', () => {
    const { scripts } = JSON.parse(readFileSync('package.json', 'utf8'));
    for (const entry of ['dist:win', 'dist:win:offline', 'dist:win:lite']) {
      expect(scripts[entry]).toBe('bun run dist:win:setup');
    }
    expect(scripts['dist:win:setup']).toBe(
      'bun run dist:win:nsis && bun run build:installer-shell && bun run pack:installer-shell',
    );
    expect(scripts['dist:win:nsis']).toContain('electron-builder --win nsis');
    expect(scripts['dist:win:signed']).toContain('--config electron-builder.windows-signed.cjs');
    expect(scripts['dist:win:enterprise']).toContain('--config electron-builder.enterprise.cjs');
  });
});
