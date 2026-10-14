import { configService } from './config';

type ThemeType = 'light' | 'dark' | 'system';

/** One built-in appearance pair. CSS and recipes are compiled at build time. */
class ThemeService {
  private mediaQuery: MediaQueryList | null = null;
  private currentTheme: ThemeType = 'system';
  private effectiveTheme: 'light' | 'dark' = 'light';
  private initialized = false;

  initialize(): void {
    if (this.initialized) return;
    this.initialized = true;
    this.mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    this.mediaQuery.addEventListener('change', event => {
      if (this.currentTheme === 'system') this.applyAppearance(event.matches ? 'dark' : 'light');
    });
    try {
      this.setTheme(configService.getConfig().theme);
    } catch {
      this.setTheme('system');
    }
  }

  setTheme(theme: ThemeType): void {
    this.currentTheme = ['light', 'dark', 'system'].includes(theme) ? theme : 'system';
    this.applyAppearance(
      this.currentTheme === 'system'
        ? this.mediaQuery?.matches
          ? 'dark'
          : 'light'
        : this.currentTheme,
    );
  }

  getTheme(): ThemeType {
    return this.currentTheme;
  }
  getEffectiveTheme(): 'light' | 'dark' {
    return this.effectiveTheme;
  }

  private applyAppearance(appearance: 'light' | 'dark'): void {
    this.effectiveTheme = appearance;
    const root = document.documentElement;
    root.dataset.theme = `classic-${appearance}`;
    root.classList.toggle('dark', appearance === 'dark');
    root.classList.toggle('light', appearance === 'light');
    root.style.colorScheme = appearance;
  }
}

export const themeService = new ThemeService();
