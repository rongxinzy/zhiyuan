import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const readSource = (relativePath: string): string =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');

const appSource = readSource('../../App.tsx');
const modelSettingsSource = readSource('../settings/model/ModelSettingsPanel.tsx');
const availableModelsSource = readSource('../../services/availableModels.ts');
const localInferenceSource = readSource('./LocalInferenceView.tsx');
const modelsPanelSource = readSource('./panels/ModelsPanel.tsx');

test('keeps model-load cancellation reachable through the loading overlay', () => {
  expect(modelsPanelSource).toContain('pointer-events-none absolute inset-0');
  expect(modelsPanelSource).toContain('className="pointer-events-auto"');
  expect(modelsPanelSource).toContain('data-local-inference-cancel-load-button="true"');
  expect(modelsPanelSource).toContain('{loadingModel ? null : isRunning ? (');
});

test('opens unified model settings without rewriting local provider configuration', () => {
  const handler = appSource.match(
    /const handleOpenLocalModelSettings = useCallback\(\(\) => \{([\s\S]*?)\}, \[handleShowSettings\]\);/,
  );
  expect(handler).not.toBeNull();
  expect(handler?.[1]).toContain("handleShowSettings({ initialTab: 'model' })");
  expect(handler?.[1]).not.toContain('updateConfig');
  expect(handler?.[1]).not.toContain('providers');
  expect(handler?.[1]).not.toContain('magpie.start');
  expect(appSource).toContain('onOpenModelSettings={handleOpenLocalModelSettings}');
});

test('model settings consume the unified catalog rather than a second local provider list', () => {
  expect(modelSettingsSource).toContain('refreshMagpieModels()');
  expect(modelSettingsSource).toContain('selectMagpieDefaultModel(selection)');
  expect(availableModelsSource).toContain('window.electron.magpie.catalog()');
  expect(availableModelsSource).toContain('window.electron.magpie.selectDefault(id)');
  expect(availableModelsSource).not.toContain('listRunningModels');
  expect(availableModelsSource).not.toContain('config.providers');
  expect(modelSettingsSource).not.toContain('ProviderModelRow');
});

test('refreshes the kept-alive local inference view on navigation requests', () => {
  expect(appSource).toContain('setLocalInferenceRefreshRequestId(current => current + 1);');
  expect(appSource).toContain('refreshRequestId={localInferenceRefreshRequestId}');
  expect(localInferenceSource).toContain('refreshRequestId?: number;');
  expect(localInferenceSource).toContain('if (!isVisible) return;');
  expect(localInferenceSource).toContain('refreshRequestId,');
  expect(localInferenceSource).toContain('await refreshLocalModels();');
  expect(localInferenceSource).toContain('await refreshModelsDir();');
  expect(localInferenceSource).toContain('await refreshModelPreferences();');
});
