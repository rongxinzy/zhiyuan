#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const npmLockfiles = ['scripts/release/package-lock.json'];

// Keep this list deliberately small. A new registry, Git dependency, or URL
// dependency must be explicitly reviewed before it can enter a release.
const approvedNpmRegistries = new Set([
  'https://registry.npmjs.org',
  'https://registry.npmmirror.com',
]);

const violations = [];

for (const lockfile of npmLockfiles) {
  const raw = await readFile(resolve(lockfile), 'utf8');
  const lock = JSON.parse(raw);

  for (const [packagePath, entry] of Object.entries(lock.packages ?? {})) {
    if (!entry?.resolved) continue;

    let origin;
    try {
      origin = new URL(entry.resolved).origin;
    } catch {
      violations.push(`${lockfile}: ${packagePath || '<root>'} has a non-HTTPS package source`);
      continue;
    }

    if (!approvedNpmRegistries.has(origin)) {
      violations.push(
        `${lockfile}: ${packagePath || '<root>'} resolves from unapproved registry ${origin}`,
      );
    }

    if (!entry.integrity) {
      violations.push(`${lockfile}: ${packagePath || '<root>'} is missing an integrity hash`);
    }
  }
}

if (violations.length > 0) {
  console.error('Supply-chain input policy failed:');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log(`Supply-chain input policy passed: ${npmLockfiles.length} npm lockfiles checked.`);
