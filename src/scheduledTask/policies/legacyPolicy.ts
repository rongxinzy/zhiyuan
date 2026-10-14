import { OriginKind, RunBehavior, SessionTarget, WakeMode } from '../constants';
import type { ExecutionBinding } from '../origin';
import type { PolicyTaskInput, PolicyTaskModel, TaskPolicy, WireBinding } from './types';

export class LegacyTaskPolicy implements TaskPolicy {
  readonly kind = OriginKind.Legacy;

  getCreateDefaults(): Partial<PolicyTaskInput> {
    return {
      sessionTarget: SessionTarget.Main,
      wakeMode: WakeMode.NextHeartbeat,
    };
  }

  normalizeDraft(draft: PolicyTaskModel): PolicyTaskModel {
    return draft;
  }

  toWireBinding(_binding: ExecutionBinding): WireBinding {
    return { sessionTarget: SessionTarget.Main, sessionKey: null };
  }

  describeRunBehavior(_task: PolicyTaskModel): string {
    return RunBehavior.newSession;
  }

  getReadonlyFields(): string[] {
    return ['origin'];
  }
}
