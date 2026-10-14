export const ELECTRON_MAIN_EXTERNALS = [
  '@agentclientprotocol/sdk',
  'better-sqlite3',
  'bufferutil',
  'node-pty',
  'utf-8-validate',
];

export const ELECTRON_RUNTIME_DEPENDENCIES = [
  '@agentclientprotocol/claude-agent-acp',
  '@agentclientprotocol/codex-acp',
  '@agentclientprotocol/sdk',
  // Explicit deployment roots: bundled application imports and Node-native storage
  // entry points must remain usable without development dependencies.
  '@earendil-works/chord',
  '@earendil-works/pi-durable',
  '@earendil-works/pi-tui',
  '@mariozechner/clipboard',
  'ajv',
  'ajv-formats',
  'better-sqlite3',
  'bufferutil',
  'debug',
  'electron-debug',
  'electron-updater',
  'google-auth-library',
  'node-pty',
  'npm',
  'pako',
  'utf-8-validate',
];
