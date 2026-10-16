import './index.css';

import { installBrowserPreviewMock } from './browser-preview/installBrowserPreviewMock';
import { TooltipProvider } from '@shared/components/ui/tooltip';

if (import.meta.env.VITE_BROWSER_PREVIEW === '1') {
  installBrowserPreviewMock();
}
import React from 'react';
import ReactDOM from 'react-dom/client';
import { Provider } from 'react-redux';

import {
  LlamaCppModelLaunchLogWindowQuery,
  LlamaCppModelLaunchLogWindowView,
} from '../shared/llamacpp';
import { EnterpriseSessionGate } from './components/enterprise/EnterpriseSessionGate';
import { ContextMenu } from './components/ContextMenu';
import { startCodingFailureNoticeListener } from './services/codingFailureNotice';
import { startRuntimeNoticeListener } from './services/runtimeNotice';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Failed to find the root element');
}

const routeParams = new URLSearchParams(window.location.search);
const isModelLaunchLogWindow =
  routeParams.get(LlamaCppModelLaunchLogWindowQuery.View) ===
  LlamaCppModelLaunchLogWindowView.ModelLaunchLog;

const root = ReactDOM.createRoot(rootElement);
let activityUnsubscribe: (() => void) | null = null;
let runtimeNoticeUnsubscribe: (() => void) | null = null;
let codingFailureUnsubscribe: (() => void) | null = null;
let devNetworkUnsubscribe: (() => void) | null = null;

async function renderRoot(): Promise<void> {
  if (isModelLaunchLogWindow) {
    const { ModelLaunchLogWindow } =
      await import('./components/localInference/windows/ModelLaunchLogWindow');
    root.render(
      <React.StrictMode>
        <TooltipProvider>
          <ModelLaunchLogWindow />
        </TooltipProvider>
      </React.StrictMode>,
    );
    return;
  }

  // 2026/09/17 lixiang  开发态：主进程 HTTP → xr-net beacon → DevTools Network
  if (import.meta.env.DEV && import.meta.env.VITE_BROWSER_PREVIEW !== '1') {
    const { startDevNetworkBeacon } = await import('./services/devNetworkBeacon');
    devNetworkUnsubscribe?.();
    devNetworkUnsubscribe = startDevNetworkBeacon();
  }

  const [{ default: App }, { store }] = await Promise.all([import('./App'), import('./store')]);

  runtimeNoticeUnsubscribe?.();
  runtimeNoticeUnsubscribe = startRuntimeNoticeListener();
  codingFailureUnsubscribe?.();
  codingFailureUnsubscribe = startCodingFailureNoticeListener();

  const { hydrateRuns, upsertRun } = await import('./store/slices/activitySlice');
  activityUnsubscribe?.();
  activityUnsubscribe = window.electron.activity.onUpdated(run => store.dispatch(upsertRun(run)));
  const activityResult = await window.electron.activity.list();
  if (activityResult.success) store.dispatch(hydrateRuns(activityResult.runs));

  const { BrowserPreviewDevPanel } = import.meta.env.VITE_BROWSER_PREVIEW
    ? await import('./browser-preview/BrowserPreviewDevPanel')
    : { BrowserPreviewDevPanel: () => null };

  root.render(
    <React.StrictMode>
      <EnterpriseSessionGate>
        <Provider store={store}>
          <App />
          <ContextMenu />
          <BrowserPreviewDevPanel />
        </Provider>
      </EnterpriseSessionGate>
    </React.StrictMode>,
  );
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    activityUnsubscribe?.();
    activityUnsubscribe = null;
    runtimeNoticeUnsubscribe?.();
    runtimeNoticeUnsubscribe = null;
    codingFailureUnsubscribe?.();
    codingFailureUnsubscribe = null;
    devNetworkUnsubscribe?.();
    devNetworkUnsubscribe = null;
  });
}

void renderRoot().catch(error => {
  console.error('Failed to render the app:', error);
  try {
    window.electron?.log?.fromRenderer?.(
      'error',
      'Renderer',
      `Failed to render the app: ${error instanceof Error ? error.message : String(error)}`,
    );
  } catch {
    // Ignore logging failures while the renderer is already failing to start.
  }
});
