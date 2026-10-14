import type { ZhiyuanEnterpriseHostContext } from './host-contract.js';
import type { ZhiyuanLicenseActivation } from './license/activation.js';
import type { ZhiyuanPasswordSession } from './session/password-session.js';
import {
  createZhiyuanSessionRuntimeComponents,
  type SessionRuntimeDependencies,
} from './session/runtime.js';

export interface ZhiyuanExtensionRuntime {
  readonly session: ZhiyuanPasswordSession;
  readonly licenseActivation?: ZhiyuanLicenseActivation | null;
  dispose(): Promise<void>;
}

export async function createZhiyuanExtensionRuntime(
  context: ZhiyuanEnterpriseHostContext,
  dependencies: SessionRuntimeDependencies = {},
): Promise<ZhiyuanExtensionRuntime> {
  const components = await createZhiyuanSessionRuntimeComponents(context, dependencies);
  components.licenseActivation?.start();
  let disposed = false;
  return Object.freeze({
    session: components.session,
    licenseActivation: components.licenseActivation,
    dispose: async () => {
      if (disposed) return;
      disposed = true;
      components.licenseActivation?.stop();
    },
  });
}
