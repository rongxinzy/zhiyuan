import { recipe } from './recipe';

const contentMix = (strength: number) =>
  `color-mix(in srgb, var(--foreground) ${strength}%, transparent)`;

/** Briefing columns: typography-led sections with ink-mix rows (MonoCode transcript density). */
export function workBriefingAppearances() {
  return {
    'briefing-section-title': recipe({
      base: {
        'font-size': 'var(--zy-component-text-sm)',
        'font-weight': 'var(--zy-component-font-weight-semibold)',
        'letter-spacing': '0.01em',
        color: contentMix(90),
        'line-height': '1.375',
      },
    }),
    'briefing-item': recipe({
      base: {
        padding: '0.75rem',
        'border-radius': 'var(--zy-style-radius-lg)',
        'border-width': '1px',
        'border-style': 'solid',
        'border-color': contentMix(7),
        'background-color': contentMix(4),
        'transition-property': 'background-color, border-color',
        'transition-duration': '120ms',
        'transition-timing-function': 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
      hover: {
        'background-color': contentMix(6),
        'border-color': contentMix(10),
      },
    }),
    'briefing-item-headline': recipe({
      base: {
        'font-size': 'var(--zy-component-text-sm)',
        'font-weight': 'var(--zy-component-font-weight-medium)',
        color: 'var(--foreground)',
        'line-height': '1.375',
      },
    }),
  };
}
