// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
vi.mock('./config', () => ({
  configService: { getConfig: () => ({ theme: 'system', themeStyle: 'removed-style' }) },
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  document.body.replaceChildren();
});

test('uses only default light/dark and follows system without reviving stored style packages', async () => {
  let change: ((event: { matches: boolean }) => void) | undefined;
  const add = vi.fn((_event: string, callback: typeof change) => {
    change = callback;
  });
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: add,
    removeEventListener: vi.fn(),
  }));
  localStorage.setItem('zhiyuan-theme-id', 'weiyang-dark');
  const { themeService } = await import('./theme');
  themeService.initialize();
  themeService.initialize();
  expect(add).toHaveBeenCalledTimes(1);
  expect(themeService.getEffectiveTheme()).toBe('light');
  expect(document.documentElement.dataset.theme).toBe('classic-light');
  change?.({ matches: true });
  expect(themeService.getEffectiveTheme()).toBe('dark');
  expect(document.documentElement.classList.contains('dark')).toBe(true);
  themeService.setTheme('light');
  change?.({ matches: true });
  expect(themeService.getEffectiveTheme()).toBe('light');
  expect(localStorage.getItem('zhiyuan-theme-id')).toBe('weiyang-dark');
  expect(document.querySelector('#zhiyuan-theme-styles')).toBeNull();
});

test('appearance changes preserve draft, focus, selection and scroll without replacing stylesheets', async () => {
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  const { themeService } = await import('./theme');
  themeService.initialize();
  const input = document.createElement('textarea');
  document.body.append(input);
  input.value = 'Keep this draft';
  input.focus();
  input.setSelectionRange(2, 6);
  input.scrollTop = 13;
  themeService.setTheme('light');
  themeService.setTheme('dark');
  expect(document.activeElement).toBe(input);
  expect(input.value).toBe('Keep this draft');
  expect([input.selectionStart, input.selectionEnd, input.scrollTop]).toEqual([2, 6, 13]);
  expect(themeService.getTheme()).toBe('dark');
  expect(document.documentElement.style.colorScheme).toBe('dark');
});
