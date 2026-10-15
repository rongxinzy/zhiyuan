import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
const html = readFileSync('scripts/installer-shell/preview/index.html', 'utf8');
const windows: JSDOM[] = [];
function mount(query = '', hosted = true) {
  const start = vi.fn<() => PromiseLike<void>>(() => Promise.resolve());
  const uninstall = vi.fn<() => PromiseLike<void>>(() => Promise.resolve());
  const launch = vi.fn(() => Promise.resolve(false));
  const close = vi.fn<() => PromiseLike<void>>(() => Promise.resolve());
  const cancel = vi.fn<() => PromiseLike<void>>(() => Promise.resolve());
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
                StartUninstall: uninstall,
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
    uninstall,
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
    await vi.waitFor(() =>
      expect((ui.document.querySelector('#btnLaunch') as HTMLButtonElement).disabled).toBe(false),
    );
    ui.launch.mockResolvedValue(true);
    ui.click('#btnLaunch');
    await Promise.resolve();
    await Promise.resolve();
    await vi.waitFor(() => expect(ui.close).toHaveBeenCalledOnce());
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
    await vi.waitFor(() => expect(ui.cancel).toHaveBeenCalledOnce());
    expect(ui.document.querySelector('.page.active')?.id).toBe('page-progress');
    ui.event({ type: 'error', message: 'Cancelled after rollback' });
    expect(ui.document.querySelector('.page.active')?.id).toBe('page-error');
    expect(ui.document.querySelector('#errorMessage')?.textContent).toBe(
      'Cancelled after rollback',
    );
    expect(ui.post).not.toHaveBeenCalled();
  });
  it.each(['install', 'uninstall'])(
    'retains early Cancel through delayed %s admission without waiting for the operation',
    async operation => {
      const ui = mount(operation === 'uninstall' ? '?page=uninstall' : '');
      let acknowledgeStart = () => {};
      const pendingStart = new Promise<void>(resolve => {
        acknowledgeStart = resolve;
      });
      (operation === 'install' ? ui.start : ui.uninstall).mockReturnValue({
        then: pendingStart.then.bind(pendingStart),
      });
      const settled = Promise.resolve();
      const then = vi.fn(settled.then.bind(settled));
      ui.cancel.mockReturnValue({ then });
      if (operation === 'install') ui.click('#licenseCheck');
      ui.click(operation === 'install' ? '#btnInstall' : '#btnConfirmUninstall');
      const button = ui.document.querySelector('#btnCancelProgress') as HTMLButtonElement;
      expect(button.disabled).toBe(false);
      ui.click('#btnCancelProgress');
      expect(ui.cancel).not.toHaveBeenCalled();
      expect(ui.document.querySelector('.page.active')?.id).toBe('page-progress');
      await Promise.resolve();
      expect(ui.cancel).not.toHaveBeenCalled();
      acknowledgeStart();
      await vi.waitFor(() => expect(then).toHaveBeenCalledOnce());
      expect(ui.cancel).toHaveBeenCalledExactlyOnceWith();
      expect(ui.document.querySelector('.page.active')?.id).toBe('page-progress');
      ui.event({
        type: 'error',
        message: 'Cancelled after rollback',
        detail: 'cancelled by user',
      });
      expect(ui.document.querySelector('.page.active')?.id).toBe('page-error');
      expect(ui.post).not.toHaveBeenCalled();
    },
  );
  it('does not send Cancel after admission rejects, and a Retry gets its own cancellable admission', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ui = mount();
    let rejectStart = (_error: Error) => {};
    const pendingStart = new Promise<void>((_resolve, reject) => {
      rejectStart = reject;
    });
    ui.start.mockReturnValue({ then: pendingStart.then.bind(pendingStart) });
    ui.click('#licenseCheck');
    ui.click('#btnInstall');
    ui.click('#btnCancelProgress');
    rejectStart(new Error('Start admission rejected'));
    await vi.waitFor(() =>
      expect(ui.document.querySelector('#errorMessage')?.textContent).toContain(
        'Start admission rejected',
      ),
    );
    expect(ui.cancel).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledOnce();
    ui.click('#btnRetry');
    ui.start.mockReturnValue(Promise.resolve());
    ui.click('#btnInstall');
    ui.click('#btnCancelProgress');
    await vi.waitFor(() => expect(ui.cancel).toHaveBeenCalledExactlyOnceWith());
    expect(ui.start).toHaveBeenCalledTimes(2);
    expect(ui.document.querySelector('.page.active')?.id).toBe('page-progress');
  });
  it.each([false, true])(
    'does not apply an older pending Cancel to a newer Retry admission (old rejects: %s)',
    async rejects => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const ui = mount();
      let acknowledgeStart = () => {};
      const pendingStart = new Promise<void>((resolve, reject) => {
        acknowledgeStart = () =>
          rejects ? reject(new Error('Previous admission rejected')) : resolve();
      });
      ui.start.mockReturnValue({ then: pendingStart.then.bind(pendingStart) });
      ui.click('#licenseCheck');
      ui.click('#btnInstall');
      ui.click('#btnCancelProgress');
      ui.event({ type: 'error', message: 'Previous attempt failed' });
      ui.click('#btnRetry');
      ui.start.mockReturnValue(Promise.resolve());
      ui.click('#btnInstall');
      acknowledgeStart();
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(ui.cancel).not.toHaveBeenCalled();
      ui.click('#btnCancelProgress');
      await vi.waitFor(() => expect(ui.cancel).toHaveBeenCalledExactlyOnceWith());
      expect(ui.document.querySelector('.page.active')?.id).toBe('page-progress');
    },
  );
  it('handles then-only Cancel rejection without claiming rollback or exposing Retry during installation', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ui = mount();
    ui.click('#licenseCheck');
    ui.click('#btnInstall');
    const rejected = Promise.reject(new Error('Cancel request rejected'));
    ui.cancel.mockReturnValue({ then: rejected.then.bind(rejected) });
    ui.click('#btnCancelProgress');
    await vi.waitFor(() => expect(log).toHaveBeenCalledOnce());
    expect(ui.document.querySelector('.page.active')?.id).toBe('page-progress');
    expect(ui.document.querySelector('#errorMessage')?.textContent).toBe('');
    expect(ui.document.querySelector('#launchError')?.textContent).toBe('');
    expect((ui.document.querySelector('#btnCancelProgress') as HTMLButtonElement).disabled).toBe(
      false,
    );
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

describe('installer brand and license review', () => {
  it('opens the real local license without granting consent', async () => {
    const ui = mount('?lang=zh');
    const dialog = ui.document.getElementById('licenseDialog') as HTMLDialogElement;
    const show = vi.fn();
    dialog.showModal = show;
    const license = vi.fn(() => Promise.resolve('LOCAL LICENSE TEXT'));
    const window = ui.document.defaultView!;
    (
      window as unknown as {
        chrome: { webview: { hostObjects: { shell: Record<string, unknown> } } };
      }
    ).chrome.webview.hostObjects.shell.GetLicenseText = license;
    ui.click('#btnLicense');
    await vi.waitFor(() => expect(show).toHaveBeenCalledOnce());
    expect(license).toHaveBeenCalledOnce();
    expect(ui.document.querySelector('#licenseText')?.textContent).toBe('LOCAL LICENSE TEXT');
    expect(ui.document.querySelector('#licenseCheck')?.getAttribute('aria-checked')).toBe('false');
    expect((ui.document.querySelector('#btnInstall') as HTMLButtonElement).disabled).toBe(true);
    expect(ui.start).not.toHaveBeenCalled();
  });

  it('keeps license read errors visible without granting consent', async () => {
    const ui = mount('?lang=en');
    const dialog = ui.document.getElementById('licenseDialog') as HTMLDialogElement;
    const show = vi.fn();
    dialog.showModal = show;
    const window = ui.document.defaultView!;
    (
      window as unknown as {
        chrome: { webview: { hostObjects: { shell: Record<string, unknown> } } };
      }
    ).chrome.webview.hostObjects.shell.GetLicenseText = () =>
      Promise.reject(new Error('Unavailable'));
    ui.click('#btnLicense');
    await vi.waitFor(() => expect(show).toHaveBeenCalledOnce());
    expect(ui.document.querySelector('#licenseText')?.textContent).toContain(
      'The license could not be read',
    );
    expect((ui.document.querySelector('#btnInstall') as HTMLButtonElement).disabled).toBe(true);
    expect(ui.start).not.toHaveBeenCalled();
  });

  it('ships the website-inspired palette without remote assets or runtime dependencies', () => {
    expect(html).toContain('--brand: #090d16');
    expect(html).toContain('--serif:');
    expect(html).toContain('prefers-reduced-motion');
    expect(html).toContain('forced-colors');
    expect(html).not.toMatch(/(?:src|href)=["']https?:|@import|@font-face/);
    expect(html).toContain('id="completeTitle"');
  });
});

it('retains the full install path for copying, tooltips and assistive technology', async () => {
  const ui = mount('?lang=zh');
  await Promise.resolve();
  await Promise.resolve();
  const path = ui.document.getElementById('installPath')!;
  expect(path.title).toBe(path.textContent);
  expect(path.getAttribute('aria-label')).toBe(path.textContent);
  expect(path.textContent).toContain('知远');
});

it('renders the existing uninstall completion selector without discarding data wording', async () => {
  const ui = mount('?page=uninstall&lang=en');
  ui.event({ type: 'done' });
  await vi.waitFor(() =>
    expect(ui.document.querySelector('.page.active')?.id).toBe('page-complete'),
  );
  expect(ui.document.querySelector('#completeTitle')?.textContent).toBe(
    'ZhiYuan Agent uninstalled',
  );
  expect(ui.document.querySelector('#completeSub')?.textContent).toContain(
    'personal files are kept',
  );
  expect((ui.document.querySelector('#btnLaunch') as HTMLElement).style.display).toBe('none');
});

it('keeps one brand mark and a task heading instead of repeating the product name', () => {
  const ui = mount('?lang=zh');
  expect(ui.document.querySelectorAll('#wordmarkImg')).toHaveLength(1);
  expect(ui.document.querySelector('.titlebar #wordmarkImg')).not.toBeNull();
  expect(ui.document.querySelector('#page-hero h1')?.textContent).toBe('开始你的 AI 工作台');
  expect(ui.document.querySelector('#page-hero')?.textContent).not.toContain('(ZhiYuan Agent)');
});

it('does not add a second admission on repeated clicks', () => {
  const ui = mount('?lang=en');
  ui.click('#licenseCheck');
  ui.click('#btnInstall');
  ui.click('#btnInstall');
  ui.click('#btnInstall');
  expect(ui.start).toHaveBeenCalledTimes(1);
});

describe('launch button pending admission', () => {
  it.each([false, true])(
    'admits once while pending and restores retry after failure (%s)',
    async rejects => {
      const ui = mount();
      let resolve!: (value: boolean) => void;
      let reject!: (error: Error) => void;
      ui.launch.mockReturnValue(
        new Promise<boolean>((yes, no) => {
          resolve = yes;
          reject = no;
        }),
      );
      ui.click('#btnLaunch');
      ui.click('#btnLaunch');
      ui.click('#btnLaunch');
      await vi.waitFor(() => expect(ui.launch).toHaveBeenCalledOnce());
      expect((ui.document.querySelector('#btnLaunch') as HTMLButtonElement).disabled).toBe(true);
      if (rejects) reject(new Error('Launch rejected'));
      else resolve(false);
      await vi.waitFor(() =>
        expect((ui.document.querySelector('#btnLaunch') as HTMLButtonElement).disabled).toBe(false),
      );
      expect(ui.close).not.toHaveBeenCalled();
      if (rejects)
        expect(ui.document.querySelector('#launchError')?.textContent).toContain('Launch rejected');
      ui.launch.mockResolvedValue(true);
      ui.click('#btnLaunch');
      await vi.waitFor(() => expect(ui.close).toHaveBeenCalledOnce());
      expect(ui.launch).toHaveBeenCalledTimes(2);
    },
  );
});
