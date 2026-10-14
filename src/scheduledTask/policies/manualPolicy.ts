import { buildManagedSessionKey } from '../../main/libs/managedSessionKey';
import { BindingKind, OriginKind, RunBehavior, SessionTarget, WakeMode } from '../constants';
import type { ExecutionBinding } from '../origin';
import type { PolicyTaskInput, PolicyTaskModel, TaskPolicy, WireBinding } from './types';

export class ManualTaskPolicy implements TaskPolicy {
  readonly kind = OriginKind.Manual;

  getCreateDefaults(): Partial<PolicyTaskInput> {
    return {
      sessionTarget: SessionTarget.Isolated,
      wakeMode: WakeMode.Now,
    };
  }

  normalizeDraft(draft: PolicyTaskModel): PolicyTaskModel {
    return draft;
  }

  toWireBinding(binding: ExecutionBinding): WireBinding {
    switch (binding.kind) {
      case BindingKind.NewSession:
        return { sessionTarget: SessionTarget.Main, sessionKey: null };
      case BindingKind.UISession:
        return {
          sessionTarget: SessionTarget.Main,
          sessionKey: buildManagedSessionKey(binding.sessionId),
        };
      case BindingKind.SessionKey:
        return { sessionTarget: SessionTarget.Isolated, sessionKey: binding.sessionKey };
    }
  }

  describeRunBehavior(task: PolicyTaskModel): string {
    switch (task.binding.kind) {
      case BindingKind.NewSession:
        return RunBehavior.newSession;
      case BindingKind.UISession:
        return RunBehavior.uiSession;
      case BindingKind.SessionKey:
        return RunBehavior.sessionKey;
    }
  }

  getReadonlyFields(): string[] {
    return [];
  }
}
