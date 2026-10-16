import { createBrowserPreviewElectronMock } from './createBrowserPreviewElectronMock';

export function installBrowserPreviewMock(): void {
  if (typeof window === 'undefined') return;
  if (window.electron) return;
  window.electron = createBrowserPreviewElectronMock();
}
