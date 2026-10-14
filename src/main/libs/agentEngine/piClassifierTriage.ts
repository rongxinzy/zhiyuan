/**
 * Message-tier classification through native pi-ai classifier models.
 *
 * llama.cpp chat models answer classifications from next-token label
 * probabilities (pi's `llama-cpp-classify` API), so a router-grade question
 * costs one short forward pass instead of a full generation. The classifier
 * runtime is created once per server/model pair and reused; every failure
 * path returns null so callers fall back to the rule-based result.
 */
import type { TriageTier } from '../../../shared/triage';

import type { ClassifierModel, ProviderClassifier } from '@earendil-works/pi-ai';
import type { createModels, createProvider, Models } from '@earendil-works/pi-ai/models';

/** Native ESM factories injected at app startup; no coding-agent runtime is required. */
export interface PiClassifierDeps {
  createModels: typeof createModels;
  createProvider: typeof createProvider;
  llamaCppClassifyApi: () => ProviderClassifier;
}

export type PiClassifierRuntime = Models;

export interface PiClassifierTriageOptions {
  /** llama.cpp server root, e.g. http://172.18.5.123:8000 (no /v1 suffix). */
  baseUrl: string;
  /** Chat model id served by that server, e.g. Qwen3.6-35B-A3B. */
  modelName: string;
  /** Answers below this confidence fall back to the rule result. */
  minConfidence?: number;
}

const PROVIDER_ID = 'zhiyuan-triage';
const DEFAULT_MIN_CONFIDENCE = 0.55;

const TRIAGE_QUESTION = {
  type: 'choice',
  instructions:
    'Classify the user message by the amount of model work it needs. Answer with exactly one label.',
  criteria: {
    light: 'greeting, thanks, goodbye, small talk, simple factual question, short translation',
    standard: 'normal conversation, general question, moderate instruction',
    heavy: 'complex coding task, architecture design, debugging, long analysis, refactoring',
  },
} as const;

const runtimeCache = new Map<
  string,
  { runtime: PiClassifierRuntime; model: ClassifierModel<'llama-cpp-classify'> }
>();

let triageDeps: PiClassifierDeps | null = null;

/** Wire the pi modules once at app startup (dynamic import); null disables. */
export function setTriageClassifierDeps(deps: PiClassifierDeps | null): void {
  triageDeps = deps;
  runtimeCache.clear();
}

const serverRoot = (baseUrl: string): string => baseUrl.replace(/\/v1\/?$/, '').replace(/\/+$/, '');

async function getClassifier(deps: PiClassifierDeps, options: PiClassifierTriageOptions) {
  const root = serverRoot(options.baseUrl);
  const cacheKey = `${root}|${options.modelName}`;
  const cached = runtimeCache.get(cacheKey);
  if (cached) return cached;

  const runtime = deps.createModels();
  const model: ClassifierModel<'llama-cpp-classify'> = {
    type: 'classifier',
    id: options.modelName,
    name: options.modelName,
    api: 'llama-cpp-classify',
    provider: PROVIDER_ID,
    baseUrl: `${root}/v1`,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 8_192,
  };
  runtime.setProvider(
    deps.createProvider({
      id: PROVIDER_ID,
      name: PROVIDER_ID,
      baseUrl: root,
      // Local llama.cpp is keyless. Supplying a native auth resolver keeps the
      // provider configured without reading or writing any credential store.
      auth: { apiKey: { name: 'Local classifier', resolve: async () => ({ auth: {} }) } },
      classifiers: { 'llama-cpp-classify': deps.llamaCppClassifyApi() },
      models: [model],
    }),
  );
  if (!runtime.getModelOfType('classifier', PROVIDER_ID, options.modelName)) {
    throw new Error(`classifier model ${options.modelName} did not register`);
  }
  const entry = { runtime, model };
  runtimeCache.set(cacheKey, entry);
  return entry;
}

/** Classify a message into a triage tier; null means "use the rule result". */
export async function classifyTierWithPi(
  prompt: string,
  options: PiClassifierTriageOptions,
  deps: PiClassifierDeps | null = triageDeps,
): Promise<{ tier: TriageTier; confidence: number } | null> {
  if (!deps || !options.baseUrl || !options.modelName) return null;
  try {
    const { runtime, model } = await getClassifier(deps, options);
    const result = await runtime.classify(
      model,
      {
        state: { message: prompt.replace(/\n/g, ' ').trim().slice(0, 400) },
        questions: { tier: TRIAGE_QUESTION },
      },
      { temperature: 1 },
    );
    if (result.stopReason !== 'stop' || result.errorMessage) return null;
    const answer = result.answers?.tier;
    if (answer?.type !== 'choice') return null;
    const choice = answer.choice;
    const confidence = answer.confidence;
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null;
    if (choice !== 'light' && choice !== 'standard' && choice !== 'heavy') return null;
    if (confidence < (options.minConfidence ?? DEFAULT_MIN_CONFIDENCE)) return null;
    return { tier: choice, confidence };
  } catch {
    return null;
  }
}

/** Thin wrapper for modelTriage: null when deps are absent or classification failed. */
export async function classifyTierForTriage(
  prompt: string,
  baseUrl: string,
  modelName: string,
): Promise<{ tier: TriageTier; confidence: number } | null> {
  if (!triageDeps) return null;
  return classifyTierWithPi(prompt, { baseUrl, modelName }, triageDeps);
}

/** Test hook: drop cached classifier runtimes. */
export function resetPiClassifierCache(): void {
  runtimeCache.clear();
}
