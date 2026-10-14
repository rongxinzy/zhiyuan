/**
 * Warms lazily loaded feature-area chunks on hover/focus intent so the
 * Suspense fallback is rarely visible when the user actually clicks
 * (issue #141). Import specifiers must match the React.lazy declarations
 * in App.tsx so the browser reuses the same chunk.
 */
export type PrefetchableFeatureView =
  | 'settings'
  | 'scheduledTasks'
  | 'activity'
  | 'localInference'
  | 'expert'
  | 'todo'
  | 'history';

export const prefetchFeatureView = (view: PrefetchableFeatureView): void => {
  switch (view) {
    case 'history':
      void import('./history/HistoryBrowser').catch(() => undefined);
      break;
    case 'settings':
      void import('./settings/SettingsPage').catch(() => undefined);
      break;
    case 'scheduledTasks':
      void import('./scheduledTasks').catch(() => undefined);
      break;
    case 'activity':
      void import('./activity').catch(() => undefined);
      break;
    case 'localInference':
      void import('./localInference').catch(() => undefined);
      break;
    case 'expert':
      void import('./expert/ExpertView').catch(() => undefined);
      break;
    case 'todo':
      void import('./todo/TodoView').catch(() => undefined);
      break;
  }
};
