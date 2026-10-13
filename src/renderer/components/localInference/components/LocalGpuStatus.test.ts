// @vitest-environment jsdom
import { createElement } from 'react';
import { render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import { i18nService } from '../../../services/i18n';
import { useGpuSnapshot } from '../hooks/useGpuSnapshot';
import { LocalGpuStatus } from './LocalGpuStatus';

vi.mock('../hooks/useGpuSnapshot', () => ({ useGpuSnapshot: vi.fn() }));

test('distinguishes unknown measurements from real zero utilization', () => {
  vi.mocked(useGpuSnapshot).mockReturnValue({
    loading: false,
    snapshot: {
      source: 'nvidia-smi',
      available: true,
      checkedAt: '2026-10-13T00:00:00Z',
      gpus: [
        {
          index: 0,
          name: 'GPU A',
          memoryTotalMiB: 8192,
          memoryFreeMiB: 4096,
          utilizationPercent: 0,
        },
        { index: 1, name: 'GPU B', memoryTotalMiB: 16384 },
      ],
    },
  });
  render(createElement(LocalGpuStatus, { active: true }));
  expect(screen.getByRole('region')).toHaveTextContent('4.0 / 8.0 GiB');
  expect(screen.getByRole('region')).toHaveTextContent('0%');
  expect(screen.getByRole('region')).toHaveTextContent(i18nService.t('localGpuUnknown'));
  expect(screen.getByRole('region')).not.toHaveTextContent('NaN');
});

test('explains unavailable hardware without exposing internal probe errors', () => {
  vi.mocked(useGpuSnapshot).mockReturnValue({
    loading: false,
    snapshot: {
      source: 'nvidia-smi',
      available: false,
      checkedAt: '2026-10-13T00:00:00Z',
      gpus: [],
      error: 'internal raw error',
    },
  });
  render(createElement(LocalGpuStatus, { active: true }));
  expect(screen.getByRole('region')).toHaveTextContent(i18nService.t('localGpuUnavailable'));
  expect(screen.getByRole('region')).not.toHaveTextContent('internal raw error');
});
