import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'vitest';
const root = path.resolve(__dirname, '..');

test('Vite copies the current native Photon asset and cannot silently signal a missing runtime', () => {
  const viteConfig = readFileSync(path.join(root, 'vite.config.ts'), 'utf8');
  assert.match(
    viteConfig,
    /@earendil-works\/pi-durable\/node_modules\/@silvia-odwyer\/photon\/photon_rs_bg\.wasm/,
  );
  assert.doesNotMatch(viteConfig, /pi-coding-agent|photon-node/);
  assert.match(viteConfig, /throw new Error\('\[Vite\] Required Photon WASM asset was not found/);
  assert.match(
    viteConfig,
    /copyPhotonWasmPlugin\(\)\.closeBundle\(\);\s*fs\.writeFileSync\(electronReadyPath/,
  );
});
