import { buildManagedSessionKey } from '../../main/libs/managedSessionKey';
import { BindingKind, OriginKind, RunBehavior, SessionTarget, WakeMode } from '../constants';
import type { ExecutionBinding, TaskOrigin } from '../origin';
import type { PolicyTaskInput, PolicyTaskModel, TaskPolicy, WireBinding } from './types';

export class CoworkTaskPolicy implements TaskPolicy {
  readonly kind = OriginKind.Cowork;

  getCreateDefaults(origin: TaskOrigin): Partial<PolicyTaskInput> {
    if (origin.kind !== OriginKind.Cowork) {
      throw new Error('Invalid origin for CoworkTaskPolicy');
    }
    return {
      sessionTarget: SessionTarget.Main,
      wakeMode: WakeMode.Now,
    };
  }

  normalizeDraft(draft: PolicyTaskModel): PolicyTaskModel {
    return draft;
  }

  toWireBinding(binding: ExecutionBinding): WireBinding {
    if (binding.kind === BindingKind.UISession) {
      return {
        sessionTarget: SessionTarget.Main,
        sessionKey: buildManagedSessionKey(binding.sessionId),
      };
    }
    if (binding.kind === BindingKind.SessionKey) {
      return { sessionTarget: SessionTarget.Isolated, sessionKey: binding.sessionKey };
    }
    return { sessionTarget: SessionTarget.Main, sessionKey: null };
  }

  describeRunBehavior(task: PolicyTaskModel): string {
    if (task.binding.kind === BindingKind.UISession) {
      return RunBehavior.uiSession;
    }
    return RunBehavior.newSession;
  }

  getReadonlyFields(): string[] {
    return ['origin'];
  }
}
