/** Renderer preferences never expose the retired provider/credential configuration. */
export function projectAppPreferences(input: unknown): Record<string, unknown> {
  const value =
    input && typeof input === 'object' && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  const result: Record<string, unknown> = {};
  if (['light', 'dark', 'system'].includes(String(value.theme))) result.theme = value.theme;
  if (['zh', 'en'].includes(String(value.language))) result.language = value.language;
  for (const key of ['useSystemProxy', 'sqliteAutoBackupEnabled', 'language_initialized'])
    if (typeof value[key] === 'boolean') result[key] = value[key];
  if (['work', 'chat'].includes(String(value.workMode))) result.workMode = value.workMode;
  if (value.app && typeof value.app === 'object') {
    const app = value.app as Record<string, unknown>;
    const settings: Record<string, unknown> = {};
    if (
      typeof app.port === 'number' &&
      Number.isInteger(app.port) &&
      app.port > 0 &&
      app.port <= 65535
    )
      settings.port = app.port;
    if (typeof app.isDevelopment === 'boolean') settings.isDevelopment = app.isDevelopment;
    result.app = settings;
  }
  if (value.shortcuts && typeof value.shortcuts === 'object') {
    const shortcuts = value.shortcuts as Record<string, unknown>;
    result.shortcuts = Object.fromEntries(
      ['newChat', 'search', 'settings', 'sendMessage'].flatMap(key =>
        typeof shortcuts[key] === 'string' && shortcuts[key].length < 200
          ? [[key, shortcuts[key]]]
          : [],
      ),
    );
  }
  return result;
}
/** Keep retired on-disk data untouched, but never accept new renderer writes to it. */
export function mergeAppPreferences(previous: unknown, incoming: unknown): Record<string, unknown> {
  const existing =
    previous && typeof previous === 'object' && !Array.isArray(previous)
      ? (previous as Record<string, unknown>)
      : {};
  return { ...existing, ...projectAppPreferences(incoming) };
}

/** Model consent and validated selection are writable only through their dedicated IPC. */
export function isManagedModelPreference(key: unknown): boolean {
  return (
    typeof key === 'string' &&
    [
      'magpie_service_enabled',
      'magpie_subscription_accounts_enabled',
      'magpie_default_model_id',
    ].includes(key)
  );
}
