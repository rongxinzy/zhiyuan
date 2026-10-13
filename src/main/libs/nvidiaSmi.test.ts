import { expect, test } from 'vitest';

import {
  getNvidiaSmiExecutableCandidates,
  getNvidiaSmiSnapshot,
  parseNvidiaSmiCsv,
} from './nvidiaSmi';

test('nvidia-smi candidates include the packaged Windows NVIDIA utility paths', () => {
  const candidates = getNvidiaSmiExecutableCandidates('win32', {
    ProgramFiles: 'C:\\Program Files',
    ProgramW6432: 'C:\\Program Files',
    'ProgramFiles(x86)': 'C:\\Program Files (x86)',
    SystemRoot: 'C:\\Windows',
  });

  expect(candidates[0]).toBe('nvidia-smi.exe');
  expect(candidates).toContain('C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe');
  expect(candidates).toContain('C:\\Windows\\System32\\nvidia-smi.exe');
});

test('nvidia-smi falls back to an explicit Windows path when PATH lookup fails', async () => {
  const attempted: string[] = [];
  const snapshot = await getNvidiaSmiSnapshot(
    async file => {
      attempted.push(file);
      if (file === 'nvidia-smi.exe') {
        throw Object.assign(new Error('not found'), { code: 'ENOENT' });
      }
      return {
        stdout:
          '0, NVIDIA GeForce RTX 4090, 24576, 23000, 10\n1, NVIDIA GeForce RTX 4090, 24576, 23000, 0',
        stderr: '',
      };
    },
    'win32',
    { ProgramFiles: 'C:\\Program Files' },
  );

  expect(attempted).toEqual([
    'nvidia-smi.exe',
    'C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe',
  ]);
  expect(snapshot.available).toBe(true);
  expect(snapshot.gpus).toHaveLength(2);
  expect(snapshot.gpus[0]?.memoryTotalMiB).toBe(24576);
  expect(snapshot.gpus[0]?.utilizationPercent).toBe(10);
});

test('queries bounded utilization together with memory in the existing hardware snapshot', async () => {
  const snapshot = await getNvidiaSmiSnapshot(
    async (_file, args, options) => {
      expect(args).toContain('--query-gpu=index,name,memory.total,memory.free,utilization.gpu');
      expect(options.timeout).toBe(2500);
      expect(options.maxBuffer).toBe(128 * 1024);
      return { stdout: '0, GPU, 8192, 4096, 25', stderr: '' };
    },
    'linux',
    {},
  );
  expect(snapshot.gpus[0]).toEqual({
    index: 0,
    name: 'GPU',
    memoryTotalMiB: 8192,
    memoryFreeMiB: 4096,
    utilizationPercent: 25,
  });
});

test('keeps unsupported and empty samples unknown instead of inventing zero', () => {
  const gpus = parseNvidiaSmiCsv(
    [
      '0, GPU, 8192, [N/A], [Not Supported]',
      '1, GPU, 8192, , ',
      '2, GPU, 8192, 0, 0',
      '3, GPU, 8192, 99999, 101',
      '4, GPU, 8192, -1, -1',
      '5, GPU, , 0, 0',
    ].join('\n'),
  );
  expect(gpus).toHaveLength(5);
  for (const index of [0, 1, 3, 4]) {
    expect(gpus[index].memoryFreeMiB).toBeUndefined();
    expect(gpus[index].utilizationPercent).toBeUndefined();
  }
  expect(gpus[2].memoryFreeMiB).toBe(0);
  expect(gpus[2].utilizationPercent).toBe(0);
});

test('preserves commas in GPU names and handles absent hardware', async () => {
  expect(parseNvidiaSmiCsv('0, GPU, special edition, 8192, 4096, 50')[0].name).toBe(
    'GPU, special edition',
  );
  const snapshot = await getNvidiaSmiSnapshot(
    async () => {
      throw Object.assign(new Error('not found'), { code: 'ENOENT' });
    },
    'linux',
    {},
  );
  expect(snapshot.available).toBe(false);
  expect(snapshot.gpus).toEqual([]);
});
