#!/usr/bin/env node
/**
 * Prepare the complete PortableGit distribution under resources/mingit for Windows packaging/runtime.
 *
 * Features:
 * - Cross-platform execution (macOS/Linux can prepare assets for Windows packaging)
 * - Optional strict mode: --required (fail build if not prepared)
 * - Offline archive support via ZHIYUAN_PORTABLE_GIT_ARCHIVE
 * - Mirror URL override via ZHIYUAN_PORTABLE_GIT_URL
 * - Unified extraction via 7zip-bin (path7za)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const GIT_VERSION = '2.47.1';
const PORTABLE_GIT_FILE = `PortableGit-${GIT_VERSION}-64-bit.7z.exe`;
const DEFAULT_PORTABLE_GIT_URL = `https://github.com/git-for-windows/git/releases/download/v${GIT_VERSION}.windows.1/${PORTABLE_GIT_FILE}`;

const PROJECT_ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'resources', 'mingit');
const DEFAULT_ARCHIVE_PATH = path.join(PROJECT_ROOT, 'resources', PORTABLE_GIT_FILE);
const RUNTIME_DIRS = [path.join('dev', 'shm'), path.join('dev', 'mqueue')];

const PORTABLE_GIT_REQUIRED_FILES = require('./portable-git-required-files.json');

function parseArgs(argv) {
  return {
    required: argv.includes('--required'),
  };
}

function resolveInputPath(input) {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  return path.isAbsolute(trimmed) ? trimmed : path.resolve(process.cwd(), trimmed);
}

function isNonEmptyFile(filePath) {
  try {
    return fs.statSync(filePath).isFile() && fs.statSync(filePath).size > 0;
  } catch {
    return false;
  }
}

function getDirSize(dir) {
  let size = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      size += getDirSize(full);
    } else {
      size += fs.statSync(full).size;
    }
  }
  return size;
}

function resolve7zaPath() {
  let path7za;
  try {
    ({ path7za } = require('7zip-bin'));
  } catch (error) {
    throw new Error(
      'Missing dependency "7zip-bin". Run npm install and retry. ' +
        `Original error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!path7za || !fs.existsSync(path7za)) {
    throw new Error(`7zip-bin executable not found: ${path7za || '(empty path)'}`);
  }

  return path7za;
}

function findPortableGit(baseDir = OUTPUT_DIR) {
  return PORTABLE_GIT_REQUIRED_FILES.every(relative => isNonEmptyFile(path.join(baseDir, relative)))
    ? path.join(baseDir, 'cmd', 'git.exe')
    : null;
}

async function downloadArchive(url, destination) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed (${response.status} ${response.statusText}) for ${url}`);
  }

  fs.mkdirSync(path.dirname(destination), { recursive: true });

  const tmpFile = `${destination}.download`;
  try {
    const stream = fs.createWriteStream(tmpFile);
    await pipeline(Readable.fromWeb(response.body), stream);

    if (!isNonEmptyFile(tmpFile)) {
      throw new Error('Downloaded archive is empty.');
    }

    fs.renameSync(tmpFile, destination);
  } catch (error) {
    try {
      fs.rmSync(tmpFile, { force: true });
    } catch {
      // ignore cleanup errors
    }
    throw error;
  }
}

function extractArchive(archivePath) {
  const sevenZip = resolve7zaPath();
  if (fs.existsSync(OUTPUT_DIR)) {
    fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log(`[setup-mingit] Extracting archive with 7zip-bin: ${archivePath}`);
  const result = spawnSync(sevenZip, ['x', archivePath, `-o${OUTPUT_DIR}`, '-y'], {
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`7zip extraction failed with exit code ${result.status}`);
  }
}

function ensurePortableGitRuntimeDirs(required) {
  const ensured = [];
  for (const relPath of RUNTIME_DIRS) {
    const fullPath = path.join(OUTPUT_DIR, relPath);
    try {
      fs.mkdirSync(fullPath, { recursive: true });
      ensured.push(relPath);
    } catch (error) {
      const message = `Could not create runtime directory ${relPath}: ${error instanceof Error ? error.message : String(error)}`;
      if (required) {
        throw new Error(message);
      }
      console.warn(`[setup-mingit] Warning: ${message}`);
    }
  }

  if (ensured.length > 0) {
    console.log(`[setup-mingit] Ensured runtime directories: ${ensured.join(', ')}`);
  }
}

async function resolveArchive(required) {
  const envArchive = resolveInputPath(process.env.ZHIYUAN_PORTABLE_GIT_ARCHIVE);
  if (envArchive) {
    if (!isNonEmptyFile(envArchive)) {
      throw new Error(`ZHIYUAN_PORTABLE_GIT_ARCHIVE points to an invalid file: ${envArchive}`);
    }
    console.log(
      `[setup-mingit] Using local archive from ZHIYUAN_PORTABLE_GIT_ARCHIVE: ${envArchive}`,
    );
    return { archivePath: envArchive, source: 'env-archive' };
  }

  if (isNonEmptyFile(DEFAULT_ARCHIVE_PATH)) {
    console.log(`[setup-mingit] Using cached archive: ${DEFAULT_ARCHIVE_PATH}`);
    return { archivePath: DEFAULT_ARCHIVE_PATH, source: 'cache' };
  }

  const urlFromEnv =
    typeof process.env.ZHIYUAN_PORTABLE_GIT_URL === 'string'
      ? process.env.ZHIYUAN_PORTABLE_GIT_URL.trim()
      : '';
  const downloadUrl = urlFromEnv || DEFAULT_PORTABLE_GIT_URL;

  try {
    console.log(`[setup-mingit] Downloading PortableGit from: ${downloadUrl}`);
    await downloadArchive(downloadUrl, DEFAULT_ARCHIVE_PATH);
    const fileSizeMB = (fs.statSync(DEFAULT_ARCHIVE_PATH).size / 1024 / 1024).toFixed(1);
    console.log(`[setup-mingit] Downloaded archive (${fileSizeMB} MB): ${DEFAULT_ARCHIVE_PATH}`);
    return { archivePath: DEFAULT_ARCHIVE_PATH, source: 'download' };
  } catch (error) {
    if (required) {
      throw new Error(
        'Unable to obtain PortableGit archive. ' +
          'Set ZHIYUAN_PORTABLE_GIT_ARCHIVE to a local offline package or ' +
          'set ZHIYUAN_PORTABLE_GIT_URL to a reachable mirror. ' +
          `Original error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    console.warn(
      '[setup-mingit] PortableGit archive is not available; skip because --required is not set. ' +
        `Reason: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

async function ensurePortableGit(options = {}) {
  const required = Boolean(options.required);
  const shouldRun =
    process.platform === 'win32' || required || process.env.ZHIYUAN_SETUP_MINGIT_FORCE === '1';

  if (!shouldRun) {
    console.log(
      '[setup-mingit] Skip on non-Windows host (pass --required to force cross-platform preparation).',
    );
    return { ok: true, skipped: true, gitPath: null };
  }

  const existingGit = findPortableGit();
  if (existingGit) {
    ensurePortableGitRuntimeDirs(required);
    console.log(`[setup-mingit] PortableGit already prepared: ${existingGit}`);
    return { ok: true, skipped: false, gitPath: existingGit };
  }

  const archive = await resolveArchive(required);
  if (!archive) {
    return { ok: true, skipped: true, gitPath: null };
  }

  extractArchive(archive.archivePath);
  const resolvedGit = findPortableGit();
  if (!resolvedGit) {
    throw new Error(
      'PortableGit extraction is missing the Git launcher, implementation or required DLLs: ' +
        PORTABLE_GIT_REQUIRED_FILES.join(', '),
    );
  }

  ensurePortableGitRuntimeDirs(required);
  // Keep the official distribution intact, including transport helpers and their libraries.

  const finalSize = getDirSize(OUTPUT_DIR);
  console.log(`[setup-mingit] PortableGit ready: ${resolvedGit}`);
  console.log(`[setup-mingit] Total size: ~${(finalSize / 1024 / 1024).toFixed(1)} MB`);

  return { ok: true, skipped: false, gitPath: resolvedGit };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await ensurePortableGit({ required: args.required });
}

if (require.main === module) {
  main().catch(error => {
    console.error('[setup-mingit] ERROR:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

module.exports = {
  ensurePortableGit,
  findPortableGit,
};
