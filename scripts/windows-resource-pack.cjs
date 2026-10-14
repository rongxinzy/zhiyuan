'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const EXCLUDED_FILE_PATTERNS = [
  /\.map$/i,
  /\.d\.(ts|cts|mts)$/i,
  /^(readme|changelog|history)(\.(md|txt|rst))?$/i,
  /^(license|licence|authors|contributors)(\.(md|txt))?$/i,
  /^\.(eslintrc|prettierrc|editorconfig|npmignore|gitignore|gitattributes)/i,
  /^tsconfig(\..+)?\.json$/i,
  /^(jest|vitest)\.config/i,
  /^\.babelrc/i,
  /^babel\.config/i,
  /\.(test|spec)\.\w+$/i,
];
const EXCLUDED_DIRECTORIES = new Set([
  'test',
  'tests',
  '__tests__',
  '__mocks__',
  '.github',
  'example',
  'examples',
  'coverage',
  '.venv',
  '.bin',
]);

function shouldExclude(entryPath) {
  const segments = entryPath.split(/[/\\]/);
  if (segments.some(segment => EXCLUDED_DIRECTORIES.has(segment.toLowerCase()))) return true;
  const basename = path.basename(entryPath);
  if (/^\.env(\..+)?$/i.test(basename)) return true;
  return EXCLUDED_FILE_PATTERNS.some(pattern => pattern.test(basename));
}

const WINDOWS_RESOURCE_COMPONENT_SCHEMA_VERSION = 4;
const WINDOWS_RESOURCE_ARCHIVE_EXTENSION = '.7z';
const WINDOWS_RESOURCE_ARCHIVE_FORMAT = '7z';
const WINDOWS_RESOURCE_ARCHIVE_COMPRESSION = {
  NonSolid: {
    id: 'lzma2-mx9-nonsolid-v1',
    sevenZipArgs: ['-mx=9', '-m0=lzma2', '-ms=off', '-mmt=on'],
  },
  PortableGitBcj2: {
    id: 'lzma-bcj2-d128m-mx9-solid-v1',
    sevenZipArgs: [
      '-mx=9',
      '-m0=BCJ2',
      '-m1=LZMA:d=128m',
      '-m2=LZMA:d=128m',
      '-m3=LZMA:d=128m',
      '-mb0:1',
      '-mb0s1:2',
      '-mb0s2:3',
      '-ms=on',
      '-mmt=on',
    ],
  },
};

function getWindowsResourceArchiveCompression(component) {
  if (component.key === 'portable-git') {
    return WINDOWS_RESOURCE_ARCHIVE_COMPRESSION.PortableGitBcj2;
  }
  return WINDOWS_RESOURCE_ARCHIVE_COMPRESSION.NonSolid;
}

function getWindowsResourceComponents(projectRoot) {
  return [
    {
      key: 'portable-git',
      label: 'PortableGit runtime',
      dir: path.join(projectRoot, 'resources', 'mingit'),
      prefix: 'mingit',
      sentinel: 'mingit/cmd/git.exe',
    },
  ];
}

function getWindowsResourcePayloadFiles(manifest, projectRoot) {
  const components = getWindowsResourceComponents(projectRoot);
  const expectedKeys = components.map(component => component.key).sort();
  const actualKeys = (manifest.components || []).map(component => component.key).sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    throw new Error(
      '[windows-resource-pack] Component manifest does not match current packaging inputs.',
    );
  }
  return components.flatMap(component =>
    ['7z', 'version', 'sha256', 'sentinel-sha256'].map(suffix => `${component.key}.${suffix}`),
  );
}

function computeWindowsResourceComponentId(component) {
  if (!fs.existsSync(component.dir)) {
    throw new Error('[windows-resource-pack] Missing ' + component.label + ': ' + component.dir);
  }
  const hash = crypto.createHash('sha256');
  hash.update(
    'zhiyuan-windows-resource-component-v' + WINDOWS_RESOURCE_COMPONENT_SCHEMA_VERSION + '\0',
  );
  hash.update(
    'component\0' + component.key + '\0' + component.prefix + '\0' + component.sentinel + '\0',
  );
  hashDirectory(hash, component.dir, '');
  return hash.digest('hex');
}

function hashDirectory(hash, directory, relativeDirectory, ancestorDirectories = new Set()) {
  const realDirectory = fs.realpathSync(directory);
  if (ancestorDirectories.has(realDirectory)) {
    throw new Error('[windows-resource-pack] Symlink cycle detected at ' + directory);
  }
  const nextAncestors = new Set(ancestorDirectories);
  nextAncestors.add(realDirectory);
  const entries = fs
    .readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name, 'en'));

  for (const entry of entries) {
    const relativePath = relativeDirectory ? relativeDirectory + '/' + entry.name : entry.name;
    if (shouldExclude(relativePath)) continue;

    const absolutePath = path.join(directory, entry.name);
    const stat = fs.statSync(absolutePath);
    if (stat.isDirectory()) {
      hash.update('directory\0' + relativePath + '\0');
      hashDirectory(hash, absolutePath, relativePath, nextAncestors);
      continue;
    }
    if (!stat.isFile()) continue;

    hash.update('file\0' + relativePath + '\0' + stat.size + '\0');
    const fileDescriptor = fs.openSync(absolutePath, 'r');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    try {
      let bytesRead = 0;
      do {
        bytesRead = fs.readSync(fileDescriptor, buffer, 0, buffer.length, null);
        if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
      } while (bytesRead > 0);
    } finally {
      fs.closeSync(fileDescriptor);
    }
    hash.update('\0');
  }
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const fileDescriptor = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(fileDescriptor, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(fileDescriptor);
  }
  return hash.digest('hex');
}

function buildWindowsResourceComponentManifest(
  component,
  contentId,
  archiveSha256,
  archiveSizeBytes,
  sentinelSha256,
) {
  const compression = getWindowsResourceArchiveCompression(component);
  return {
    version: WINDOWS_RESOURCE_COMPONENT_SCHEMA_VERSION,
    key: component.key,
    label: component.label,
    prefix: component.prefix,
    sentinel: component.sentinel,
    contentId,
    archive: component.key + WINDOWS_RESOURCE_ARCHIVE_EXTENSION,
    archiveFormat: WINDOWS_RESOURCE_ARCHIVE_FORMAT,
    archiveCompression: compression.id,
    archiveSha256,
    archiveSizeBytes,
    sentinelSha256,
  };
}

function isWindowsResourceComponentReusable(manifestPath, archivePath, contentId, component) {
  if (!fs.existsSync(manifestPath) || !fs.existsSync(archivePath)) return false;
  try {
    const saved = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    return (
      saved.version === WINDOWS_RESOURCE_COMPONENT_SCHEMA_VERSION &&
      saved.key === component.key &&
      saved.prefix === component.prefix &&
      saved.sentinel === component.sentinel &&
      saved.contentId === contentId &&
      saved.archive === component.key + WINDOWS_RESOURCE_ARCHIVE_EXTENSION &&
      saved.archiveFormat === WINDOWS_RESOURCE_ARCHIVE_FORMAT &&
      saved.archiveCompression === getWindowsResourceArchiveCompression(component).id &&
      typeof saved.archiveSha256 === 'string' &&
      saved.archiveSha256 === sha256File(archivePath) &&
      saved.archiveSizeBytes === fs.statSync(archivePath).size
    );
  } catch {
    return false;
  }
}

function buildWindowsResourceBundleManifest(componentManifests) {
  return {
    version: WINDOWS_RESOURCE_COMPONENT_SCHEMA_VERSION,
    offline: true,
    excludes: ['llama.cpp'],
    components: componentManifests,
  };
}

module.exports = {
  WINDOWS_RESOURCE_COMPONENT_SCHEMA_VERSION,
  WINDOWS_RESOURCE_ARCHIVE_EXTENSION,
  WINDOWS_RESOURCE_ARCHIVE_FORMAT,
  WINDOWS_RESOURCE_ARCHIVE_COMPRESSION,
  buildWindowsResourceBundleManifest,
  buildWindowsResourceComponentManifest,
  computeWindowsResourceComponentId,
  getWindowsResourceComponents,
  getWindowsResourcePayloadFiles,
  getWindowsResourceArchiveCompression,
  isWindowsResourceComponentReusable,
  sha256File,
  shouldExclude,
};
