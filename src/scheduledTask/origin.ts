import { parseManagedSessionKey } from '../main/libs/managedSessionKey';
import { BindingKind, OriginKind } from './constants';

export type TaskOriginKind = OriginKind;

export type TaskOrigin =
  | { kind: typeof OriginKind.Legacy }
  | { kind: typeof OriginKind.Cowork; sessionId: string }
  | { kind: typeof OriginKind.Manual };

export type ExecutionBinding =
  | { kind: typeof BindingKind.NewSession }
  | { kind: typeof BindingKind.UISession; sessionId: string }
  | { kind: typeof BindingKind.SessionKey; sessionKey: string };

/** Infer only application-owned session bindings; channel routing is not supported. */
export function inferOriginAndBinding(task: { sessionKey?: string | null }): {
  origin: TaskOrigin;
  binding: ExecutionBinding;
} {
  const sessionKey = task.sessionKey?.trim();
  const managed = parseManagedSessionKey(sessionKey);
  if (managed) {
    return {
      origin: { kind: OriginKind.Cowork, sessionId: managed.sessionId },
      binding: { kind: BindingKind.UISession, sessionId: managed.sessionId },
    };
  }
  if (sessionKey) {
    return {
      origin: { kind: OriginKind.Cowork, sessionId: '' },
      binding: { kind: BindingKind.SessionKey, sessionKey },
    };
  }
  return {
    origin: { kind: OriginKind.Manual },
    binding: { kind: BindingKind.NewSession },
  };
}
