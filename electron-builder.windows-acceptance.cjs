'use strict';

const base = require('./electron-builder.json');

// Explicitly unsigned CI acceptance artifacts. Keep resource editing (icon and
// version metadata), but never load a signing provider or publish an update.
module.exports = {
  ...base,
  forceCodeSigning: false,
  publish: null,
  afterSign: null,
  beforePack: './scripts/ci/windows-acceptance-resources.cjs',
  afterPack: './scripts/ci/windows-acceptance-resources.cjs',
  extraMetadata: { ...base.extraMetadata, zhiyuanAcceptanceBuild: true },
  win: {
    ...base.win,
    target: [{ target: 'nsis', arch: ['x64'] }],
    publish: null,
    signExecutable: false,
    signtoolOptions: null,
    azureSignOptions: null,
  },
  nsis: {
    ...base.nsis,
    artifactName: 'ZhiYuan-Agent-Acceptance-${version}-${arch}.${ext}',
    runAfterFinish: false,
    deleteAppDataOnUninstall: false,
  },
};
