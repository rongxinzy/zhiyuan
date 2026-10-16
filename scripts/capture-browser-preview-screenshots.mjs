#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outputDir =
  process.env.BROWSER_PREVIEW_SCREENSHOT_DIR || path.join(projectRoot, 'docs/theme-previews');
const baseUrl =
  process.env.BROWSER_PREVIEW_URL || 'http://127.0.0.1:5175/index.browser-preview.html';

const APP_CONFIG_KEY = 'app_config';
const WORKSPACE_SIDEBAR_STATE_KEY = 'workspaceSidebar.state';

const VIEWPORT = { width: 1440, height: 900 };

const captures = [
  {
    slug: 'cowork-home',
    navigate: 'cowork',
    wait: async page => {
      await page.getByRole('region').first().waitFor({ state: 'visible', timeout: 60_000 });
      await page
        .getByLabel(/进展与结果/)
        .getByText('季度路线图整理')
        .waitFor({ state: 'visible', timeout: 60_000 });
    },
  },
  {
    slug: 'cowork-session',
    navigate: 'cowork',
    wait: async page => {
      await page.evaluate(() => {
        window.dispatchEvent(
          new CustomEvent('browser-preview:load-session', {
            detail: 'preview-session-roadmap',
          }),
        );
      });
      await page.getByText('导航收敛').waitFor({ state: 'visible', timeout: 60_000 });
    },
  },
  {
    slug: 'local-inference',
    navigate: 'localInference',
    wait: async page => {
      await page
        .getByText('Qwen2.5-14B-Instruct-Q4_K_M', { exact: false })
        .first()
        .waitFor({ state: 'visible', timeout: 90_000 });
    },
  },
  {
    slug: 'skills-mcp',
    navigate: 'skillsMcp',
    wait: async page => {
      await page.getByText('技能与 MCP').first().waitFor({ state: 'visible', timeout: 60_000 });
    },
  },
  {
    slug: 'settings',
    navigate: 'settings',
    wait: async page => {
      await page.getByLabel('设置').waitFor({ state: 'visible', timeout: 60_000 });
      await page.getByText('通用').first().waitFor({ state: 'visible', timeout: 60_000 });
    },
  },
];

function seedAppConfig(theme) {
  return {
    theme,
    language: 'zh',
    workMode: 'work',
    useSystemProxy: false,
    sqliteAutoBackupEnabled: false,
    app: { port: 3000, isDevelopment: true },
    shortcuts: {
      newChat: 'CmdOrCtrl+N',
      search: 'CmdOrCtrl+F',
      settings: 'CmdOrCtrl+,',
      sendMessage: 'Enter',
    },
  };
}

function seedWorkspaceSidebarState() {
  const workspaceIds = ['preview-ws-main', 'preview-ws-research', 'preview-ws-ops'];
  return {
    expandedWorkspaceIds: workspaceIds,
    expandedTaskListWorkspaceIds: workspaceIds,
    scheduledExpandedWorkspaceIds: workspaceIds,
    scheduledExpandedTaskListWorkspaceIds: workspaceIds,
  };
}

async function openPreviewForTheme(browser, theme) {
  const page = await browser.newPage({ viewport: VIEWPORT });
  await page.addInitScript(
    ({ key, config, sidebarKey, sidebarState }) => {
      localStorage.setItem(key, JSON.stringify(config));
      localStorage.setItem(sidebarKey, JSON.stringify(sidebarState));
    },
    {
      key: APP_CONFIG_KEY,
      config: seedAppConfig(theme),
      sidebarKey: WORKSPACE_SIDEBAR_STATE_KEY,
      sidebarState: seedWorkspaceSidebarState(),
    },
  );
  await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 120_000 });
  await page.waitForSelector('[data-testid="sidebar-new-conversation"]', { timeout: 120_000 });
  await page.waitForFunction(
    expectedTheme => document.documentElement.dataset.theme === `classic-${expectedTheme}`,
    theme,
    { timeout: 30_000 },
  );
  await page.addStyleTag({
    content: '[data-testid="browser-preview-panel"]{display:none!important}',
  });
  return page;
}

async function navigateToView(page, viewId) {
  await page.evaluate(id => {
    window.dispatchEvent(new CustomEvent('browser-preview:navigate', { detail: id }));
  }, viewId);
}

function md5File(filePath) {
  return crypto.createHash('md5').update(fs.readFileSync(filePath)).digest('hex');
}

async function capture() {
  fs.mkdirSync(outputDir, { recursive: true });
  const browser = await chromium.launch();
  const results = [];

  for (const theme of ['light', 'dark']) {
    for (const capture of captures) {
      const page = await openPreviewForTheme(browser, theme);
      if (capture.navigate !== 'cowork') {
        await navigateToView(page, capture.navigate);
      }
      await capture.wait(page);
      await page.waitForTimeout(400);
      const filePath = path.join(
        outputDir,
        `browser-preview-${capture.slug}-1440x900-${theme}.png`,
      );
      await page.screenshot({ path: filePath, fullPage: false });
      const hash = md5File(filePath);
      const stats = fs.statSync(filePath);
      if (stats.size < 50_000) {
        throw new Error(
          `[BrowserPreviewScreenshots] ${filePath} looks too small (${stats.size} bytes); main canvas may be empty`,
        );
      }
      results.push({ theme, slug: capture.slug, filePath, hash, size: stats.size });
      console.log(
        `[BrowserPreviewScreenshots] wrote ${filePath} (${stats.size} bytes, md5=${hash})`,
      );
      await page.close();
    }
  }

  await browser.close();

  for (const capture of captures) {
    const light = results.find(entry => entry.slug === capture.slug && entry.theme === 'light');
    const dark = results.find(entry => entry.slug === capture.slug && entry.theme === 'dark');
    if (!light || !dark) continue;
    if (light.hash === dark.hash) {
      throw new Error(
        `[BrowserPreviewScreenshots] ${capture.slug} light/dark screenshots are identical (md5=${light.hash})`,
      );
    }
  }

  console.log('[BrowserPreviewScreenshots] verified distinct light/dark captures for all views');
}

capture().catch(error => {
  console.error('[BrowserPreviewScreenshots] failed:', error);
  process.exit(1);
});
