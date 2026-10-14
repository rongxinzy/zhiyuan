import path from 'node:path';

export function isolatedEnvironment(root, source = process.env) {
  const env = {};
  const read = name =>
    Object.entries(source).find(([key]) => key.toUpperCase() === name.toUpperCase())?.[1];
  // Deliberate allowlist: no API keys, account tokens, agent overrides, Electron
  // switches, inherited NODE_OPTIONS or Python configuration from the CI host.
  for (const key of [
    'SystemRoot',
    'WINDIR',
    'SystemDrive',
    'NUMBER_OF_PROCESSORS',
    'PROCESSOR_ARCHITECTURE',
  ]) {
    if (read(key)) env[key] = read(key);
  }
  const systemRoot = env.SystemRoot || env.WINDIR;
  if (!systemRoot) throw new Error('Windows SystemRoot is required');
  return {
    ...env,
    // PowerShell discovers suffixless native commands through PATHEXT. A
    // secret-free profile still needs these standard Windows process values.
    PATHEXT: '.COM;.EXE;.BAT;.CMD',
    COMSPEC: path.win32.join(systemRoot, 'System32', 'cmd.exe'),
    PATH: `${path.win32.join(systemRoot, 'System32')};${systemRoot}`,
    HOME: root,
    USERPROFILE: root,
    APPDATA: path.join(root, 'AppData', 'Roaming'),
    LOCALAPPDATA: path.join(root, 'AppData', 'Local'),
    TEMP: path.join(root, 'tmp'),
    TMP: path.join(root, 'tmp'),
    HOMEDRIVE: path.win32.parse(root).root.replace(/\\$/, ''),
    HOMEPATH: path.win32.parse(root).root
      ? root.slice(path.win32.parse(root).root.length - 1)
      : root,
    ZHIYUAN_MEMORY_LEAK_TEST_USER_DATA: path.join(root, 'user-data'),
  };
}
