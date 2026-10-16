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
const BRIEFING_SCENARIO_KEY = 'browser-preview.briefingScenario';
const BRIEFING_SCENARIO_FULL = 'full';

const VIEWPORT = { width: 1440, height: 900 };

const captures = [
  {
    slug: 'cowork-home',
    navigate: 'cowork',
    wait: async page => {
      await page
        .getByRole('region', { name: /等你决策/ })
        .waitFor({ state: 'visible', timeout: 60_000 });
      await page
        .getByRole('region', { name: /已为你推进/ })
        .waitFor({ state: 'visible', timeout: 60_000 });
      await page
        .getByRole('region', { name: /建议下一步/ })
        .waitFor({ state: 'visible', timeout: 60_000 });
      await page
        .getByRole('region', { name: /等你决策/ })
        .getByText('侧栏 Phase 1 走查')
        .waitFor({ state: 'visible', timeout: 60_000 });
      await page
        .getByRole('region', { name: /建议下一步/ })
        .getByText('夜间巡检报告')
        .waitFor({ state: 'visible', timeout: 60_000 });
      await page
        .getByText('要删除 3 个旧构建产物，需要你确认')
        .waitFor({ state: 'visible', timeout: 60_000 });
      await page
        .getByText('上次运行被中断，可打开记录查看已保存的部分结果。')
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
      await page.getByRole('button', { name: '继续这项工作' }).waitFor({
        state: 'visible',
        timeout: 60_000,
      });
      if ((await page.getByText('暂时无法读取这项工作的恢复状态').count()) > 0) {
        throw new Error('[BrowserPreviewScreenshots] durable recovery load failed in preview');
      }
    },
  },
  {
    slug: 'task-board',
    navigate: 'taskBoard',
    wait: async page => {
      await page.getByTestId('task-board-columns').waitFor({ state: 'visible', timeout: 60_000 });
      await page.getByTestId('sidebar-task-board').waitFor({ state: 'visible', timeout: 60_000 });
      await page.getByRole('region', { name: '待开始' }).waitFor({ state: 'visible', timeout: 60_000 });
      await page.getByRole('region', { name: '进行中' }).waitFor({ state: 'visible', timeout: 60_000 });
      await page
        .getByRole('region', { name: '需要处理' })
        .waitFor({ state: 'visible', timeout: 60_000 });
      await page
        .getByRole('region', { name: '等你确认' })
        .waitFor({ state: 'visible', timeout: 60_000 });
      await page.getByRole('region', { name: '已完成' }).waitFor({ state: 'visible', timeout: 60_000 });
      const board = page.getByTestId('task-board-columns');
      await board.getByRole('button', { name: /侧栏 Phase 1 走查/ }).waitFor({
        state: 'visible',
        timeout: 60_000,
      });
      await board.getByRole('button', { name: /发布流水线预检/ }).waitFor({
        state: 'visible',
        timeout: 60_000,
      });
      await board.getByRole('button', { name: /渠道同步/ }).waitFor({
        state: 'visible',
        timeout: 60_000,
      });
      await board.getByRole('button', { name: /夜间巡检报告/ }).waitFor({
        state: 'visible',
        timeout: 60_000,
      });
      const needsAttention = page.getByRole('region', { name: '需要处理' });
      await needsAttention.getByText('需要处理', { exact: true }).first().waitFor({
        state: 'visible',
        timeout: 60_000,
      });
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
    ({ key, config, sidebarKey, sidebarState, briefingKey, briefingScenario }) => {
      localStorage.setItem(key, JSON.stringify(config));
      localStorage.setItem(sidebarKey, JSON.stringify(sidebarState));
      localStorage.setItem(briefingKey, briefingScenario);
    },
    {
      key: APP_CONFIG_KEY,
      config: seedAppConfig(theme),
      sidebarKey: WORKSPACE_SIDEBAR_STATE_KEY,
      sidebarState: seedWorkspaceSidebarState(),
      briefingKey: BRIEFING_SCENARIO_KEY,
      briefingScenario: BRIEFING_SCENARIO_FULL,
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
