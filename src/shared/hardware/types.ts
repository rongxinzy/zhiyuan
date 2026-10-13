export type NvidiaGpuInfo = {
  index: number;
  name: string;
  memoryTotalMiB: number;
  memoryFreeMiB?: number;
  /** Omitted when the driver cannot report a valid utilization sample. */
  utilizationPercent?: number;
};

export type NvidiaSmiSnapshot = {
  source: 'nvidia-smi';
  available: boolean;
  checkedAt: string;
  gpus: NvidiaGpuInfo[];
  error?: string;
};

export type SystemMemorySnapshot = {
  source: 'system';
  available: boolean;
  checkedAt: string;
  totalMemoryMiB: number;
  freeMemoryMiB: number;
  error?: string;
};
