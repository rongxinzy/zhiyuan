import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import net from 'node:net';
import type {
  MagpieStatus,
  MagpieModel,
  MagpieAgents,
  MagpieModelSelection,
} from '../../shared/magpie/types';
import { isolatedMagpieEnvironment, prepareMagpieHome } from './environment';
import { MAGPIE_VERSION, verifyMagpieBinary } from './integrity';
const MODEL_FIELDS = new Set(['model', 'large', 'small', 'executor', 'planner']);
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as net.AddressInfo).port;
      server.close(error => (error ? reject(error) : resolve(port)));
    });
  });
}
export interface MagpieManagerOptions {
  resourcesRoot: string;
  privateHome: string;
  /** Tests must supply temporary HOME and USERPROFILE; production retains the real CLI home. */
  environment?: NodeJS.ProcessEnv;
  verify?: typeof verifyMagpieBinary;
  spawn?: typeof spawn;
  fetch?: typeof fetch;
  port?: () => Promise<number>;
  startupTimeoutMs?: number;
}
/** Owns exactly one verified, isolated upstream process. Never attaches to existing gateways. */
export class MagpieManager {
  private state: MagpieStatus = { state: 'stopped', version: MAGPIE_VERSION };
  private child?: ChildProcess;
  private pending?: Promise<MagpieStatus>;
  private stopping?: Promise<MagpieStatus>;
  private abort?: AbortController;
  private webPort?: number;
  private webKey?: string;
  constructor(private readonly options: MagpieManagerOptions) {}
  status(): MagpieStatus {
    return { ...this.state };
  }
  start(): Promise<MagpieStatus> {
    if (this.stopping) return this.stopping.then(() => this.start());
    if (this.pending) return this.pending;
    if (this.state.state === 'running') return Promise.resolve(this.status());
    this.abort = new AbortController();
    this.state = { state: 'starting', version: MAGPIE_VERSION };
    this.pending = this.launch(this.abort.signal).finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }
  private async launch(signal: AbortSignal): Promise<MagpieStatus> {
    try {
      const binary = await (this.options.verify ?? verifyMagpieBinary)(
        this.options.resourcesRoot,
        signal,
      );
      await prepareMagpieHome(this.options.privateHome);
      const port = this.options.port ?? freePort;
      const gatewayPort = await port();
      this.webPort = await port();
      while (this.webPort === gatewayPort) this.webPort = await port();
      this.webKey = randomBytes(32).toString('hex');
      signal.throwIfAborted();
      const child = (this.options.spawn ?? spawn)(
        binary,
        ['web', '--addr', `127.0.0.1:${this.webPort}`, '--no-open'],
        {
          cwd: this.options.privateHome,
          shell: false,
          windowsHide: true,
          stdio: 'ignore',
          env: isolatedMagpieEnvironment(
            this.options.privateHome,
            gatewayPort,
            this.webKey,
            this.options.environment,
          ),
        },
      );
      this.child = child;
      let exited = false;
      child.once('error', () => {
        exited = true;
      });
      child.once('exit', () => {
        exited = true;
        if (this.child === child) {
          this.child = undefined;
          this.webKey = undefined;
          this.webPort = undefined;
          if (this.state.state === 'running')
            this.state = {
              state: 'failed',
              version: MAGPIE_VERSION,
              error: 'Local model service exited',
            };
        }
      });
      const gatewayUrl = `http://127.0.0.1:${gatewayPort}`;
      const deadline = Date.now() + (this.options.startupTimeoutMs ?? 30_000);
      while (Date.now() < deadline) {
        signal.throwIfAborted();
        if (exited) throw new Error('Magpie process exited during startup');
        try {
          const hello = await this.request(`${gatewayUrl}/api/hello`, { signal });
          const data = (await hello.json()) as { name?: string; version?: string };
          const web = await this.webRequest('/', { signal });
          if (data.name === 'magpie' && data.version === MAGPIE_VERSION && web.ok && !exited) {
            this.state = { state: 'running', version: MAGPIE_VERSION, gatewayUrl };
            return this.status();
          }
        } catch {
          signal.throwIfAborted();
        }
        await delay(100);
      }
      throw new Error('Magpie startup timed out');
    } catch {
      await this.terminate();
      this.state = {
        state: signal.aborted ? 'stopped' : 'failed',
        version: MAGPIE_VERSION,
        ...(signal.aborted ? {} : { error: 'Unable to start the verified local model service' }),
      };
      return this.status();
    }
  }
  private request(url: string, init: RequestInit = {}): Promise<Response> {
    const timeout = AbortSignal.timeout(2000);
    return (this.options.fetch ?? fetch)(url, {
      ...init,
      redirect: 'error',
      signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
    });
  }
  private webRequest(route: string, init: RequestInit = {}): Promise<Response> {
    if (!this.webPort || !this.webKey) throw new Error('Local model service is unavailable');
    return this.request(`http://127.0.0.1:${this.webPort}${route}`, {
      ...init,
      headers: { ...init.headers, Cookie: `magpie_web_${this.webPort}=${this.webKey}` },
    });
  }
  /** Main-only descriptor: never send this key through renderer IPC or logs. */
  managementConnection(): { url: string; cookieName: string; key: string } {
    if (this.state.state !== 'running' || !this.webPort || !this.webKey)
      throw new Error('Local model service is unavailable');
    return {
      url: `http://127.0.0.1:${this.webPort}`,
      cookieName: `magpie_web_${this.webPort}`,
      key: this.webKey,
    };
  }
  async models(): Promise<MagpieModel[]> {
    if (this.state.state !== 'running' || !this.state.gatewayUrl) return [];
    const response = await this.request(`${this.state.gatewayUrl}/v1/models`);
    if (!response.ok) throw new Error('Unable to load local models');
    const body = await response.text();
    if (body.length > 2_000_000) throw new Error('Model catalog exceeds size limit');
    const data = JSON.parse(body) as { data?: unknown[] };
    if (!Array.isArray(data.data) || data.data.length > 10_000)
      throw new Error('Invalid model catalog');
    return data.data.flatMap(item => {
      const model = item as { id?: unknown; owned_by?: unknown };
      return typeof model.id === 'string'
        ? [
            {
              id: model.id,
              ...(typeof model.owned_by === 'string' ? { owned_by: model.owned_by } : {}),
            },
          ]
        : [];
    });
  }
  async agents(): Promise<MagpieAgents> {
    if (this.state.state !== 'running') return { agents: [], pending: false };
    const state = await this.managementJson('/api/state');
    const cli = await this.managementJson('/api/agents/cli');
    const records = cli.agents && typeof cli.agents === 'object' ? cli.agents : {};
    return {
      pending: cli.pending === true,
      agents: (Array.isArray(state.agents) ? state.agents : [])
        .slice(0, 200)
        .flatMap((a: Record<string, unknown>) => {
          if (typeof a.id !== 'string' || typeof a.name !== 'string') return [];
          const version = records[a.id] ?? {};
          return [
            {
              id: a.id,
              name: a.name,
              cliMissing: a.cliMissing === true,
              wired: a.wired === true,
              ...(typeof version.version === 'string' ? { version: version.version } : {}),
              ...(typeof version.app === 'string' ? { appVersion: version.app } : {}),
              models: (Array.isArray(a.fields) ? a.fields : [])
                .filter(
                  (f: Record<string, unknown>) =>
                    typeof f.key === 'string' &&
                    MODEL_FIELDS.has(f.key) &&
                    typeof f.value === 'string',
                )
                .map((f: Record<string, unknown>) => ({
                  key: String(f.key),
                  label: typeof f.label === 'string' ? f.label : String(f.key),
                  value: String(f.value),
                  options: (Array.isArray(f.options) ? f.options : [])
                    .slice(0, 2000)
                    .flatMap((option: Record<string, unknown>) =>
                      typeof option.value === 'string'
                        ? [
                            {
                              value: option.value,
                              ...(typeof option.label === 'string' ? { label: option.label } : {}),
                            },
                          ]
                        : [],
                    ),
                })),
            },
          ];
        }),
    };
  }
  async setModel(selection: MagpieModelSelection): Promise<MagpieAgents> {
    if (
      !selection ||
      typeof selection.agentId !== 'string' ||
      selection.agentId.length > 100 ||
      !MODEL_FIELDS.has(selection.field) ||
      typeof selection.value !== 'string' ||
      selection.value.length > 500
    )
      throw new Error('Invalid model selection');
    const agents = await this.agents();
    if (
      !agents.agents.some(
        a =>
          a.id === selection.agentId &&
          a.models.some(
            f =>
              f.key === selection.field &&
              (f.value === selection.value ||
                f.options.some(option => option.value === selection.value)),
          ),
      )
    )
      throw new Error('Unknown agent model selection');
    await this.managementJson('/api/set', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        Agent: selection.agentId,
        Field: selection.field,
        Value: selection.value,
      }),
    });
    return this.agents();
  }
  private async managementJson(
    route: string,
    init: RequestInit = {},
  ): Promise<Record<string, any>> {
    const response = await this.webRequest(route, init);
    if (!response.ok) throw new Error('Local CLI management request failed');
    const text = await response.text();
    if (text.length > 1024 * 1024) throw new Error('Management response exceeds size limit');
    return JSON.parse(text);
  }
  stop(): Promise<MagpieStatus> {
    if (this.stopping) return this.stopping;
    this.abort?.abort();
    this.state = { state: 'stopping', version: MAGPIE_VERSION };
    this.stopping = (async () => {
      await this.pending;
      if (this.child) {
        try {
          await this.webRequest('/api/window/quit', { method: 'POST' });
          // Upstream WebWindow exits after its response has flushed (200 ms).
          await delay(300);
        } catch {
          /* owned process termination below */
        }
        await this.terminate();
      }
      this.state = { state: 'stopped', version: MAGPIE_VERSION };
      return this.status();
    })().finally(() => {
      this.stopping = undefined;
    });
    return this.stopping;
  }
  private async terminate(): Promise<void> {
    const child = this.child;
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await Promise.race([
        new Promise<void>(resolve => child.once('exit', () => resolve())),
        delay(1500),
      ]);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
    this.child = undefined;
    this.webKey = undefined;
    this.webPort = undefined;
  }
}
