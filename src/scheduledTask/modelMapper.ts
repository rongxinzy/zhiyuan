import type { SessionTarget, WakeMode } from './constants';
import {
  BindingKind,
  PayloadKind,
  ScheduleKind,
  SessionTarget as ST,
  WakeMode as WM,
} from './constants';
import type { ExecutionBinding, TaskOrigin } from './origin';
import { inferOriginAndBinding } from './origin';
import type { PolicyTaskInput, PolicyTaskModel, TaskPolicy } from './policies/types';

/** Minimal wire task shape for mapping (avoids importing renderer types) */
export interface WireTask {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  schedule: unknown;
  sessionTarget: SessionTarget;
  wakeMode: WakeMode;
  payload: unknown;
  workspaceId: string | null;
  sessionKey: string | null;
  state: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface TaskModelMapperResult {
  wire: WireTask;
  origin: TaskOrigin;
  binding: ExecutionBinding;
}

export class TaskModelMapper {
  fromWire(
    wire: WireTask,
    meta?: { origin: TaskOrigin; binding: ExecutionBinding },
  ): PolicyTaskModel {
    const resolved = meta ?? inferOriginAndBinding(wire);
    return {
      ...wire,
      origin: resolved.origin,
      binding: resolved.binding,
    };
  }

  toWireInput(model: PolicyTaskModel, policy: TaskPolicy): PolicyTaskInput {
    const wireBinding = policy.toWireBinding(model.binding);
    return {
      name: model.name,
      description: model.description,
      enabled: model.enabled,
      schedule: model.schedule,
      sessionTarget: wireBinding.sessionTarget,
      wakeMode: model.wakeMode,
      payload: model.payload,
      workspaceId: model.workspaceId,
      sessionKey: wireBinding.sessionKey,
    };
  }

  createDraft(origin: TaskOrigin, defaults: Partial<PolicyTaskInput>): PolicyTaskModel {
    const now = new Date().toISOString();
    const defaultBinding: ExecutionBinding = { kind: BindingKind.NewSession };

    return {
      id: `draft-${Date.now()}`,
      name: defaults.name ?? '',
      description: defaults.description ?? '',
      enabled: defaults.enabled ?? true,
      schedule: defaults.schedule ?? { kind: ScheduleKind.Every, everyMs: 3600000 },
      sessionTarget: defaults.sessionTarget ?? ST.Main,
      wakeMode: defaults.wakeMode ?? WM.Now,
      payload: defaults.payload ?? { kind: PayloadKind.SystemEvent, text: '' },
      workspaceId: defaults.workspaceId ?? null,
      sessionKey: defaults.sessionKey ?? null,
      state: {
        nextRunAtMs: null,
        lastRunAtMs: null,
        lastStatus: null,
        lastError: null,
        lastDurationMs: null,
        runningAtMs: null,
        consecutiveErrors: 0,
      },
      createdAt: now,
      updatedAt: now,
      origin,
      binding: defaultBinding,
    };
  }
}
