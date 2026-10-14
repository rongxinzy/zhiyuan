// Copied into an isolated extraction of the built app.asar, then executed by
// the packaged Electron binary with ELECTRON_RUN_AS_NODE=1. Never run against
// the development checkout: that could conceal missing production modules.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { Harness } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';

const require = createRequire(import.meta.url);
assert.equal(typeof Harness.open, 'function');
assert.ok(BACKGROUND_CONTEXT);
const native = new DatabaseSync(':memory:');
assert.equal(native.prepare('select 1 as value').get().value, 1);
native.close();
const storage = await openNodeSqliteStorage(path.join(import.meta.dirname, 'acceptance.sqlite'));
await storage.close(BACKGROUND_CONTEXT);
const Database = require('better-sqlite3');
const applicationDatabase = new Database(':memory:');
assert.equal(applicationDatabase.prepare('select 2 as value').get().value, 2);
applicationDatabase.close();
const { loadNativeModule } = require('node-pty/lib/utils.js');
for (const name of ['pty', 'conpty', 'conpty_console_list'])
  assert.ok(loadNativeModule(name).module);
await WebAssembly.compile(
  fs.readFileSync(path.join(import.meta.dirname, 'dist-electron/photon_rs_bg.wasm')),
);
console.log(
  `WINDOWS_ACCEPTANCE_RUNTIME_OK ${JSON.stringify({ electron: process.versions.electron, node: process.versions.node, modules: process.versions.modules, sqlite: true, durable: true, pty: true, photon: true })}`,
);
