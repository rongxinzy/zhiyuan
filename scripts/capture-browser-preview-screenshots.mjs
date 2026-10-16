#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outputDir =
  process.env.BROWSER_PREVIEW_SCREENSHOT_DIR || path.join(projectRoot, 'docs/theme-previews');
const baseUrl =
  process.env.BROWSER_PREVIEW_URL || 'http://127.0.0.1:5175/index.browser-preview.html';

async function setTheme(page, theme) {
  await page.evaluate(themeValue => {
    const raw = localStorage.getItem('app_config');
    const config = raw ? JSON.parse(raw) : {};
    config.theme = themeValue;
    localStorage.setItem('app_config', JSON.stringify(config));
    document.documentElement.classList.remove('light', 'dark');
    document.documentElement.classList.add(themeValue);
    document.documentElement.dataset.theme =
      themeValue === 'dark' ? 'classic-dark' : 'classic-light';
  }, theme);
  await page.waitForTimeout(400);
}

async function capture() {
  fs.mkdirSync(outputDir, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 120_000 });
  await page.waitForSelector('[data-testid="sidebar-new-conversation"]', { timeout: 120_000 });

  for (const theme of ['light', 'dark']) {
    await setTheme(page, theme);
    const sidebar = page.locator('.theme-shell-sidebar');
    await sidebar.waitFor({ state: 'visible', timeout: 30_000 });
    const filePath = path.join(outputDir, `sidebar-phase1-2026-10-16-${theme}.png`);
    await sidebar.screenshot({ path: filePath });
    console.log(`[BrowserPreviewScreenshots] wrote ${filePath}`);
  }

  await browser.close();
}

capture().catch(error => {
  console.error('[BrowserPreviewScreenshots] failed:', error);
  process.exit(1);
});
