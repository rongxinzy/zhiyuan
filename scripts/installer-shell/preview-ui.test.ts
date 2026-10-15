import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
const html = readFileSync('scripts/installer-shell/preview/index.html', 'utf8');
const windows: JSDOM[] = [];
function mount(query = '', hosted = true) {
  const start = vi.fn<() => PromiseLike<void>>(() => Promise.resolve());
  const launch = vi.fn(() => Promise.resolve(false));
  const close = vi.fn<() => PromiseLike<void>>(() => Promise.resolve());
  const cancel = vi.fn(() => Promise.resolve());
  const post = vi.fn();
  let engine: (event: { data: unknown }) => void = () => {};
  const dom = new JSDOM(html, {
    url: `https://setup.local/index.html${query}`,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
      if (!hosted) return;
      Object.defineProperty(window, 'chrome', {
        value: {
          webview: {
            hostObjects: {
              shell: {
                StartInstall: start,
                LaunchApp: launch,
                RequestClose: close,
                CancelInstall: cancel,
                GetDefaultInstallDir: () => Promise.resolve('C:\\知远\\Application'),
                GetLicenseText: () => Promise.resolve('LICENSE'),
              },
            },
            postMessage: post,
            addEventListener: (_: string, callback: typeof engine) => {
              engine = callback;
            },
          },
        },
      });
    },
  });
  windows.push(dom);
  const document = dom.window.document;
  const click = (selector: string) => (document.querySelector(selector) as HTMLElement).click();
  return {
    document,
    click,
    start,
    launch,
    close,
    cancel,
    post,
    event: (data: unknown) => engine({ data }),
  };
}
afterEach(() => {
  windows.splice(0).forEach(dom => dom.window.close());
  vi.restoreAllMocks();
});
describe('hosted installer UI contract (not Windows acceptance)', () => {
  it('requires explicit consent and passes only the chosen path to the real engine', async () => {
    const ui = mount('?lang=zh');
    await Promise.resolve();
    ui.click('#btnInstall');
    expect(ui.start).not.toHaveBeenCalled();
    ui.click('#licenseCheck');
    ui.click('#btnInstall');
    expect(ui.start).toHaveBeenCalledExactlyOnceWith('C:\\知远\\Application');
    expect(ui.document.querySelector('#page-progress')?.classList.contains('active')).toBe(true);
    expect(html).not.toMatch(/localInference|CPU.*CUDA|inferenceToggle/);
  });
  it('cannot deep-link a hosted real install into a fake completed page', () => {
    const ui = mount('?page=complete&freeze=1');
    expect(ui.document.querySelector('#page-hero')?.classList.contains('active')).toBe(true);
  });
  it.each([false, true])(
    'assimilates a then-only host proxy before handling rejection (%s)',
    async fails => {
      const ui = mount();
      // WebView2 guarantees an awaitable proxy, not a native Promise.catch method.
      const result = fails
        ? Promise.reject(new Error('Native install rejected'))
        : Promise.resolve();
      const then = vi.fn(result.then.bind(result));
      const proxy = { then };
      expect(proxy).not.toHaveProperty('catch');
      ui.start.mockReturnValue(proxy);
      ui.click('#licenseCheck');
      ui.click('#btnInstall');
      await vi.waitFor(() => expect(then).toHaveBeenCalledTimes(1));
      expect(then.mock.calls[0].map(callback => typeof callback)).toEqual(['function', 'function']);
      if (fails) {
        await vi.waitFor(() =>
          expect(ui.document.querySelector('#errorMessage')?.textContent).toContain(
            'Native install rejected',
          ),
        );
        expect(ui.document.querySelector('#page-error')?.classList.contains('active')).toBe(true);
      } else {
        expect(ui.document.querySelector('#page-progress')?.classList.contains('active')).toBe(
          true,
        );
      }
      expect(ui.document.querySelector('#page-complete')?.classList.contains('active')).toBe(false);
      expect(ui.post).not.toHaveBeenCalled();
    },
  );
  it('shows engine failure, returns to consented hero and retries without inventing completion', () => {
    const ui = mount();
    ui.click('#licenseCheck');
    ui.click('#btnInstall');
    ui.event({
      type: 'error',
      message: 'File locked',
      detail: 'Close the application and retry.',
    });
    expect(ui.document.querySelector('#page-error')?.classList.contains('active')).toBe(true);
    expect(ui.document.querySelector('#errorMessage')?.textContent).toBe('File locked');
    ui.click('#btnRetry');
    ui.click('#btnInstall');
    expect(ui.start).toHaveBeenCalledTimes(2);
    expect(ui.document.querySelector('#page-complete')?.classList.contains('active')).toBe(false);
  });
  it('keeps failed launch actionable and closes only after confirmed launch or explicit Done', async () => {
    const ui = mount('?lang=en');
    const settled = Promise.resolve();
    const then = vi.fn(settled.then.bind(settled));
    ui.close.mockReturnValue({ then });
    ui.event({ type: 'launch-error', message: 'Application missing' });
    expect(ui.document.querySelector('#launchError')?.textContent).toBe('Application missing');
    ui.click('#btnLaunch');
    await Promise.resolve();
    await Promise.resolve();
    expect(ui.close).not.toHaveBeenCalled();
    ui.launch.mockResolvedValue(true);
    ui.click('#btnLaunch');
    await Promise.resolve();
    await Promise.resolve();
    expect(ui.close).toHaveBeenCalledOnce();
    ui.close.mockClear();
    ui.click('#btnDone');
    expect(ui.close).toHaveBeenCalledExactlyOnceWith();
    expect(ui.post).not.toHaveBeenCalled();
  });
  it.each([
    ['#btnDone', 'complete'],
    ['#btnCancelHero', 'hero'],
    ['#btnCancelUninstall', 'uninstall'],
    ['#btnCloseError', 'error'],
    ['.win-btn.close', 'hero'],
  ])(
    'requests host close from %s through an awaitable proxy without changing page',
    async (selector, page) => {
      const ui = mount(page === 'uninstall' ? '?page=uninstall' : '');
      if (page === 'complete') {
        ui.event({ type: 'done' });
        await vi.waitFor(() =>
          expect(ui.document.querySelector('#page-complete')?.classList.contains('active')).toBe(
            true,
          ),
        );
      } else if (page === 'error') ui.event({ type: 'error', message: 'Installation failed' });
      const settled = Promise.resolve();
      const then = vi.fn(settled.then.bind(settled));
      ui.close.mockReturnValue({ then });
      ui.click(selector);
      expect(ui.close).toHaveBeenCalledExactlyOnceWith();
      await vi.waitFor(() => expect(then).toHaveBeenCalledOnce());
      expect(ui.document.querySelector('.page.active')?.id).toBe(`page-${page}`);
      expect(ui.launch).not.toHaveBeenCalled();
      expect(ui.post).not.toHaveBeenCalled();
    },
  );
  it('keeps progress visible when close or cancel is requested until the engine reports rollback', async () => {
    const ui = mount();
    ui.click('#licenseCheck');
    ui.click('#btnInstall');
    const settled = Promise.resolve();
    const then = vi.fn(settled.then.bind(settled));
    ui.close.mockReturnValue({ then });
    ui.click('.win-btn.close');
    await vi.waitFor(() => expect(then).toHaveBeenCalledOnce());
    expect(ui.document.querySelector('.page.active')?.id).toBe('page-progress');
    ui.click('#btnCancelProgress');
    expect(ui.cancel).toHaveBeenCalledOnce();
    expect(ui.document.querySelector('.page.active')?.id).toBe('page-progress');
    ui.event({ type: 'error', message: 'Cancelled after rollback' });
    expect(ui.document.querySelector('.page.active')?.id).toBe('page-error');
    expect(ui.document.querySelector('#errorMessage')?.textContent).toBe(
      'Cancelled after rollback',
    );
    expect(ui.post).not.toHaveBeenCalled();
  });
  it('shows a rejected close request without rewriting an already completed installation', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ui = mount();
    ui.event({ type: 'done' });
    await vi.waitFor(() =>
      expect(ui.document.querySelector('.page.active')?.id).toBe('page-complete'),
    );
    const rejected = Promise.reject(new Error('Close request rejected'));
    ui.close.mockReturnValue({ then: rejected.then.bind(rejected) });
    ui.click('#btnDone');
    await vi.waitFor(() =>
      expect(ui.document.querySelector('#launchError')?.textContent).toContain(
        'Close request rejected',
      ),
    );
    expect(ui.document.querySelector('.page.active')?.id).toBe('page-complete');
    expect(log).toHaveBeenCalledOnce();
    expect(ui.post).not.toHaveBeenCalled();
  });
  it('does not report installation failure or expose retry when close RPC rejects during progress', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ui = mount();
    ui.click('#licenseCheck');
    ui.click('#btnInstall');
    const rejected = Promise.reject(new Error('Close request rejected'));
    ui.close.mockReturnValue({ then: rejected.then.bind(rejected) });
    ui.click('.win-btn.close');
    await vi.waitFor(() => expect(log).toHaveBeenCalledOnce());
    expect(ui.document.querySelector('.page.active')?.id).toBe('page-progress');
    expect(ui.document.querySelector('#errorMessage')?.textContent).toBe('');
    expect(ui.document.querySelector('#launchError')?.textContent).toBe('');
  });
  it.each([
    ['#btnDone', 'complete'],
    ['#btnCancelHero', 'hero'],
    ['#btnCancelUninstall', 'uninstall'],
    ['#btnCloseError', 'error'],
  ])('retains the standalone preview route for %s', (selector, page) => {
    const ui = mount(`?page=${page}`, false);
    ui.click(selector);
    expect(ui.document.querySelector('.page.active')?.id).toBe('page-hero');
    expect(ui.close).not.toHaveBeenCalled();
  });
});
