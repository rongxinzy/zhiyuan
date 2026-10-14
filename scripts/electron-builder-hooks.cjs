'use strict';

const path = require('path');
const os = require('os');
const {
  existsSync,
  statSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  renameSync,
  writeFileSync,
  symlinkSync,
} = require('fs');
const { spawnSync } = require('child_process');
const { ensurePortableGit } = require('./setup-mingit.js');
const { verifyNativePackage } = require('./native-package-hygiene.cjs');
const { configureMagpieResources, verifyPackagedMagpie } = require('./magpie-runtime.cjs');
const {
  buildWindowsResourceBundleManifest,
  buildWindowsResourceComponentManifest,
  computeWindowsResourceComponentId,
  getWindowsResourceArchiveCompression,
  getWindowsResourceComponents,
  isWindowsResourceComponentReusable,
  sha256File,
} = require('./windows-resource-pack.cjs');

function isWindowsTarget(context) {
  return context?.electronPlatformName === 'win32';
}

function isMacTarget(context) {
  return context?.electronPlatformName === 'darwin';
}

function configureMacAutoUpdateMetadata(context, env = process.env) {
  if (!isMacTarget(context)) {
    return;
  }

  const enabled = env.ZHIYUAN_MAC_AUTO_UPDATE_ENABLED === 'true';
  context.packager.config.extraMetadata = {
    ...(context.packager.config.extraMetadata || {}),
    zhiyuanMacAutoUpdateEnabled: enabled,
  };
  console.log(
    `[electron-builder-hooks] macOS in-app automatic installation: ${enabled ? 'enabled' : 'disabled (manual DMG fallback)'}`,
  );
}

function resolveWindows7zaPath() {
  const sevenZipPath = path.join(
    __dirname,
    '..',
    'node_modules',
    '7zip-bin',
    'win',
    'x64',
    '7za.exe',
  );
  if (!existsSync(sevenZipPath)) {
    throw new Error(
      '[electron-builder-hooks] Missing bundled Windows 7za.exe. Run bun install before packaging.',
    );
  }
  return sevenZipPath;
}

function packWindowsResourceComponent7z(component, archivePath, sevenZipPath) {
  const stagingRoot = mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-component-7z-'));
  const stagedPrefix = path.join(stagingRoot, component.prefix);
  const temporaryArchivePath = `${archivePath}.${process.pid}.packing`;
  try {
    // A junction keeps the archive layout stable without copying a multi-hundred-MB
    // component into a temporary staging directory.  The archive is created from
    // the relative prefix only, so it never contains an absolute build-machine path.
    symlinkSync(component.dir, stagedPrefix, 'junction');
    const compression = getWindowsResourceArchiveCompression(component);
    rmSync(temporaryArchivePath, { force: true });
    const result = spawnSync(
      sevenZipPath,
      ['a', '-t7z', ...compression.sevenZipArgs, temporaryArchivePath, component.prefix],
      {
        cwd: stagingRoot,
        encoding: 'utf8',
      },
    );
    if (result.error || result.status !== 0) {
      throw new Error(
        '[electron-builder-hooks] Failed to create ' +
          component.key +
          ' .7z archive: ' +
          (result.error?.message || result.stderr || result.stdout || `exit ${result.status}`),
      );
    }
    rmSync(archivePath, { force: true });
    renameSync(temporaryArchivePath, archivePath);
  } finally {
    rmSync(temporaryArchivePath, { force: true });
    rmSync(stagingRoot, { recursive: true, force: true });
  }
}

function verifyPackagedPortableGitRuntimeDirs(appOutDir) {
  const requiredDirs = [
    path.join(appOutDir, 'resources', 'mingit', 'dev', 'shm'),
    path.join(appOutDir, 'resources', 'mingit', 'dev', 'mqueue'),
  ];
  const createdDirs = [];

  for (const dir of requiredDirs) {
    if (existsSync(dir)) continue;
    mkdirSync(dir, { recursive: true });
    createdDirs.push(dir);
  }

  const missingDirs = requiredDirs.filter(dir => !existsSync(dir));
  if (missingDirs.length > 0) {
    throw new Error(
      'Windows package is missing required PortableGit runtime directories. ' +
        `Missing: ${missingDirs.join(', ')}`,
    );
  }

  if (createdDirs.length > 0) {
    console.log(
      '[electron-builder-hooks] Created missing PortableGit runtime directories: ' +
        createdDirs.join(', '),
    );
  }

  console.log(
    '[electron-builder-hooks] Verified PortableGit runtime directories: ' + requiredDirs.join(', '),
  );
}

function applyMacIconFix(appPath) {
  console.log('[electron-builder-hooks] Applying macOS Launchpad icon fix...');

  const infoPlistPath = path.join(appPath, 'Contents', 'Info.plist');
  const resourcesPath = path.join(appPath, 'Contents', 'Resources');
  const iconPath = path.join(resourcesPath, 'icon.icns');

  if (!existsSync(infoPlistPath)) {
    console.warn(`[electron-builder-hooks] Info.plist not found at ${infoPlistPath}`);
    return;
  }

  if (!existsSync(iconPath)) {
    console.warn(`[electron-builder-hooks] icon.icns not found at ${iconPath}`);
    return;
  }

  // CFBundleIconName is only valid with an Assets.car icon. This app ships
  // icon.icns, so leaving the key set makes Launchpad ignore that file and
  // show the Electron default icon.
  const iconName = spawnSync('plutil', ['-extract', 'CFBundleIconName', 'raw', infoPlistPath], {
    encoding: 'utf-8',
  });
  if (iconName.status === 0) {
    const removeResult = spawnSync('plutil', ['-remove', 'CFBundleIconName', infoPlistPath], {
      encoding: 'utf-8',
    });
    if (removeResult.status !== 0) {
      console.warn(
        '[electron-builder-hooks] Failed to remove CFBundleIconName:',
        removeResult.stderr,
      );
    }
  }

  const iconFile = spawnSync('plutil', ['-extract', 'CFBundleIconFile', 'raw', infoPlistPath], {
    encoding: 'utf-8',
  });
  const iconFileName = iconFile.status === 0 ? iconFile.stdout.trim() : '';
  if (iconFileName !== 'icon.icns') {
    const args =
      iconFile.status === 0
        ? ['-replace', 'CFBundleIconFile', '-string', 'icon.icns', infoPlistPath]
        : ['-insert', 'CFBundleIconFile', '-string', 'icon.icns', infoPlistPath];
    const fileResult = spawnSync('plutil', args, { encoding: 'utf-8' });
    if (fileResult.status !== 0) {
      console.warn('[electron-builder-hooks] Failed to set CFBundleIconFile:', fileResult.stderr);
    }
  }

  spawnSync('xattr', ['-cr', appPath], { encoding: 'utf-8' });
  spawnSync('touch', [appPath], { encoding: 'utf-8' });
  spawnSync('touch', [resourcesPath], { encoding: 'utf-8' });
  spawnSync('touch', [iconPath], { encoding: 'utf-8' });

  console.log('[electron-builder-hooks] macOS Launchpad icon fix applied');
}

async function beforePack(context) {
  configureMagpieResources(context);
  configureMacAutoUpdateMetadata(context);

  if (isWindowsTarget(context)) {
    console.log(
      '[electron-builder-hooks] Windows target detected, ensuring bundled PortableGit...',
    );
    const portableGit = await ensurePortableGit({ required: true });
    if (!portableGit.gitPath) {
      throw new Error(
        'Bundled PortableGit health check failed before pack: Git CLI is incomplete.',
      );
    }
  }

  if (isWindowsTarget(context)) {
    // The installer remains fully offline, while each non-llama.cpp component
    // gets an independent content ID so upgrades expand only changed pieces.
    const projectRoot = path.join(__dirname, '..');
    const componentsDir = path.join(projectRoot, 'build-tar', 'windows-components');
    mkdirSync(componentsDir, { recursive: true });
    const sevenZipPath = resolveWindows7zaPath();
    const sevenZipSha256 = sha256File(sevenZipPath);
    writeFileSync(path.join(componentsDir, '7za.sha256'), sevenZipSha256, 'utf8');
    const componentManifests = [];

    for (const component of getWindowsResourceComponents(projectRoot)) {
      const archivePath = path.join(componentsDir, `${component.key}.7z`);
      const manifestPath = path.join(componentsDir, `${component.key}.manifest.json`);
      const versionPath = path.join(componentsDir, `${component.key}.version`);
      const hashPath = path.join(componentsDir, `${component.key}.sha256`);
      const sentinelHashPath = path.join(componentsDir, `${component.key}.sentinel-sha256`);
      const contentId = computeWindowsResourceComponentId(component);
      const reusable = isWindowsResourceComponentReusable(
        manifestPath,
        archivePath,
        contentId,
        component,
      );

      if (!reusable) {
        const startedAt = Date.now();
        packWindowsResourceComponent7z(component, archivePath, sevenZipPath);
        console.log(
          `[electron-builder-hooks] Packed ${component.key} ${contentId} with ${
            getWindowsResourceArchiveCompression(component).id
          } in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
        );
      }

      const archiveSha256 = sha256File(archivePath);
      const archiveSizeBytes = statSync(archivePath).size;
      const sentinelPath = path.join(
        component.dir,
        component.sentinel.slice(component.prefix.length + 1),
      );
      const sentinelSha256 = sha256File(sentinelPath);
      const manifest = buildWindowsResourceComponentManifest(
        component,
        contentId,
        archiveSha256,
        archiveSizeBytes,
        sentinelSha256,
      );
      componentManifests.push(manifest);
      writeFileSync(versionPath, contentId, 'utf8');
      writeFileSync(hashPath, archiveSha256, 'utf8');
      writeFileSync(sentinelHashPath, sentinelSha256, 'utf8');
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
      console.log(
        `[electron-builder-hooks] ${reusable ? 'Reusing' : 'Prepared'} ${component.key}: ${(
          archiveSizeBytes /
          (1024 * 1024)
        ).toFixed(1)} MB`,
      );
    }

    writeFileSync(
      path.join(componentsDir, 'manifest.json'),
      `${JSON.stringify(buildWindowsResourceBundleManifest(componentManifests), null, 2)}\n`,
      'utf8',
    );
  }

  if (!isWindowsTarget(context)) {
    return;
  }
}

function verifyPackagedNativeResources(context) {
  const platform = context.electronPlatformName === 'mas' ? 'darwin' : context.electronPlatformName;
  const arch =
    typeof context.arch === 'string'
      ? context.arch
      : { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64', 4: 'universal' }[context.arch];
  const resources =
    platform === 'darwin'
      ? path.join(
          context.appOutDir,
          `${context.packager.appInfo.productFilename}.app`,
          'Contents',
          'Resources',
        )
      : path.join(context.appOutDir, 'resources');
  const report = verifyNativePackage(resources, { platform, arch });
  const reports = path.join(context.packager.projectDir, 'build-tar', 'native-package-hygiene');
  mkdirSync(reports, { recursive: true });
  writeFileSync(
    path.join(reports, `${platform}-${arch}.json`),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  return report;
}

async function afterPack(context) {
  verifyPackagedMagpie(context);
  verifyPackagedNativeResources(context);
  if (isMacTarget(context)) {
    const appName = context.packager.appInfo.productFilename;
    const appPath = path.join(context.appOutDir, `${appName}.app`);

    if (existsSync(appPath)) {
      applyMacIconFix(appPath);
    } else {
      console.warn(`[electron-builder-hooks] App not found at ${appPath}, skipping icon fix`);
    }
  }
}

module.exports = {
  beforePack,
  afterPack,
  verifyPackagedNativeResources,
  configureMacAutoUpdateMetadata,
  packWindowsResourceComponent7z,
};
