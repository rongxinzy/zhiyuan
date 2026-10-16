import { recipe } from './recipe';

const stroke = 'color-mix(in srgb, var(--foreground) 7%, transparent)';

export function taskBoardAppearances() {
  return {
    'task-board-column': recipe({
      base: {
        gap: '0.75rem',
        'min-width': '0',
        'min-height': '12rem',
        padding: '0.75rem',
        'border-radius': 'var(--zy-style-radius-lg)',
        'border-width': '1px',
        'border-style': 'solid',
        'border-color': stroke,
        'background-color': 'color-mix(in srgb, var(--foreground) 3%, transparent)',
      },
    }),
    'task-board-column-title': recipe({
      base: {
        'font-size': 'var(--zy-component-text-xs)',
        'font-weight': 'var(--zy-component-font-weight-semibold)',
        'letter-spacing': '0.06em',
        color: 'color-mix(in srgb, var(--foreground) 55%, transparent)',
      },
    }),
    'task-board-card': recipe({
      base: {
        gap: '0.375rem',
        width: '100%',
        padding: '0.625rem',
        'border-radius': 'var(--zy-style-radius-md)',
        'border-width': '1px',
        'border-style': 'solid',
        'border-color': stroke,
        'background-color': 'color-mix(in srgb, var(--foreground) 5%, transparent)',
        'text-align': 'left',
        'transition-property': 'background-color, border-color',
        'transition-duration': '120ms',
        'transition-timing-function': 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
      hover: {
        'background-color': 'color-mix(in srgb, var(--foreground) 8%, transparent)',
        'border-color': 'color-mix(in srgb, var(--foreground) 12%, transparent)',
      },
      pressed: { translate: '0 1px' },
      focus: {
        'outline-width': '2px',
        'outline-style': 'solid',
        'outline-color': 'var(--ring)',
        'outline-offset': '2px',
      },
    }),
    'task-board-card-title': recipe({
      base: {
        'font-size': 'var(--zy-component-text-sm)',
        'font-weight': 'var(--zy-component-font-weight-medium)',
        color: 'var(--foreground)',
        'line-height': '1.375',
      },
    }),
    'task-board-card-meta': recipe({
      base: {
        'font-size': 'var(--zy-component-text-xs)',
        color: 'color-mix(in srgb, var(--foreground) 55%, transparent)',
        'line-height': '1.375',
      },
    }),
    'task-board-card-project': recipe({
      base: {
        'font-size': 'var(--zy-component-text-xs)',
        'font-weight': 'var(--zy-component-font-weight-medium)',
        color: 'color-mix(in srgb, var(--foreground) 45%, transparent)',
        'line-height': '1.25',
      },
    }),
    'task-board-attention-pill': recipe({
      base: {
        width: 'fit-content',
        padding: '0.125rem 0.375rem',
        'border-radius': 'var(--zy-style-radius-sm)',
        'font-size': 'var(--zy-component-text-xs)',
        'font-weight': 'var(--zy-component-font-weight-semibold)',
        'letter-spacing': '0.04em',
        color: 'var(--destructive)',
        'background-color': 'color-mix(in srgb, var(--destructive) 12%, transparent)',
        'border-width': '1px',
        'border-style': 'solid',
        'border-color': 'color-mix(in srgb, var(--destructive) 28%, transparent)',
      },
    }),
  };
}
