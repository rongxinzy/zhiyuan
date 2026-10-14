export const MagpieIpc = {
  status: 'magpie:status',
  start: 'magpie:start',
  stop: 'magpie:stop',
  agents: 'magpie:agents',
  setModel: 'magpie:setModel',
  models: 'magpie:models',
  openManagement: 'magpie:openManagement',
} as const;
export interface MagpieStatus {
  state: 'stopped' | 'starting' | 'running' | 'stopping' | 'failed';
  version: string;
  gatewayUrl?: string;
  error?: string;
}
export interface MagpieModel {
  id: string;
  owned_by?: string;
}
export interface MagpieApi {
  status(): Promise<MagpieStatus>;
  start(): Promise<MagpieStatus>;
  stop(): Promise<MagpieStatus>;
  agents(): Promise<MagpieAgents>;
  setModel(selection: MagpieModelSelection): Promise<MagpieAgents>;
  models(): Promise<MagpieModel[]>;
  openManagement(): Promise<void>;
}

export interface MagpieAgent {
  id: string;
  name: string;
  cliMissing: boolean;
  wired: boolean;
  version?: string;
  appVersion?: string;
  models: {
    key: string;
    label: string;
    value: string;
    options: { value: string; label?: string }[];
  }[];
}
export interface MagpieAgents {
  agents: MagpieAgent[];
  pending: boolean;
}
export interface MagpieModelSelection {
  agentId: string;
  field: string;
  value: string;
}
