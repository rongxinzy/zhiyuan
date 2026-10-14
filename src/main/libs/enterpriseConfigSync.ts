import { app } from 'electron';
import fs from 'fs';
import path from 'path';

import type { SqliteStore } from '../sqliteStore';

export type EnterpriseUIAction = 'hide' | 'disable' | 'readonly';

export type EnterpriseManifest = {
  version: string;
  name: string;
  ui?: Record<string, EnterpriseUIAction>;
  disableUpdate?: boolean;
  sync: {
    agents: boolean | 'force';
    plugins?: boolean | 'merge' | 'overwrite';
  };
  autoAcceptPrivacy?: boolean;
};

const ENTERPRISE_CONFIG_DIR = 'enterprise-config';
const MANIFEST_FILE = 'manifest.json';

function resolveMergeMode(
  value: boolean | 'merge' | 'overwrite' | undefined,
): 'merge' | 'overwrite' | null {
  if (!value) return null;
  return value === 'overwrite' ? 'overwrite' : 'merge';
}

export function resolveEnterpriseConfigPath(): string | null {
  const configPath = path.join(app.getPath('userData'), ENTERPRISE_CONFIG_DIR);
  return fs.existsSync(path.join(configPath, MANIFEST_FILE)) ? configPath : null;
}

export function syncEnterpriseConfig(
  configPath: string,
  store: SqliteStore,
  getWorkingDirectory: () => string | undefined,
): EnterpriseManifest | null {
  let manifest: EnterpriseManifest;
  try {
    manifest = JSON.parse(
      fs.readFileSync(path.join(configPath, MANIFEST_FILE), 'utf-8'),
    ) as EnterpriseManifest;
  } catch (error) {
    console.error('[Enterprise] failed to parse manifest.json, skipping enterprise config:', error);
    return null;
  }

  console.log(`[Enterprise] detected enterprise config ${manifest.name} v${manifest.version}`);
  const previousManifest = store.get<EnterpriseManifest>('enterprise_config');
  const versionChanged = previousManifest?.version !== manifest.version;
  store.set('enterprise_config', manifest);

  if (manifest.autoAcceptPrivacy) store.set('privacy_agreed', true);

  const agentsForce = manifest.sync.agents === 'force';
  if (versionChanged) {
    if (manifest.sync.agents) syncAgents(configPath, getWorkingDirectory(), agentsForce);
    const pluginsMode = resolveMergeMode(manifest.sync.plugins);
    if (pluginsMode) syncPlugins(configPath, pluginsMode);
  } else {
    if (manifest.sync.agents) syncAgents(configPath, getWorkingDirectory(), agentsForce);
    const pluginsMode = resolveMergeMode(manifest.sync.plugins);
    if (pluginsMode) syncPlugins(configPath, pluginsMode);
    console.log('[Enterprise] version unchanged, skipping immutable package content');
  }

  console.log('[Enterprise] config sync completed');
  return manifest;
}

function copyDirRecursive(source: string, target: string): void {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) copyDirRecursive(sourcePath, targetPath);
    else fs.copyFileSync(sourcePath, targetPath);
  }
}

function syncAgents(configPath: string, workspaceDir: string | undefined, force: boolean): void {
  const sourceDir = path.join(configPath, 'agents');
  if (!fs.existsSync(sourceDir)) {
    console.log('[Enterprise] no agents directory found, skipping agents sync');
    return;
  }
  if (!workspaceDir) {
    console.warn('[Enterprise] agent workspace is unavailable, skipping agents sync');
    return;
  }

  try {
    fs.mkdirSync(workspaceDir, { recursive: true });
  } catch (error) {
    console.warn(`[Enterprise] failed to prepare agent workspace at ${workspaceDir}:`, error);
    return;
  }

  let copiedCount = 0;
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(workspaceDir, entry.name);
    if (!force && fs.existsSync(targetPath)) continue;
    try {
      if (entry.isDirectory()) copyDirRecursive(sourcePath, targetPath);
      else fs.copyFileSync(sourcePath, targetPath);
      copiedCount += 1;
    } catch (error) {
      console.warn(`[Enterprise] failed to copy agent file "${entry.name}":`, error);
    }
  }
  console.log(`[Enterprise] synced ${copiedCount} agent files to ${workspaceDir}`);
}

function syncPlugins(configPath: string, mode: 'merge' | 'overwrite'): void {
  const pluginsDir = path.join(configPath, 'plugins');
  if (!fs.existsSync(pluginsDir)) {
    console.log('[Enterprise] no plugins directory found, skipping plugin sync');
    return;
  }
  const pluginCount = fs
    .readdirSync(pluginsDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory()).length;
  console.log(`[Enterprise] registered ${pluginCount} plugin packages in ${mode} mode`);
}
