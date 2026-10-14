# Default appearance and component recipes

The application has one built-in visual design with light and dark appearances. Settings offers light, dark, or system mode only. There is no theme registry, package loader, theme import/export, dynamic stylesheet injection, or background customization.

- `themes/classic-light.ts` and `themes/classic-dark.ts` supply the default token values.
- `tokens/contract.ts` defines semantic variables; `components/contract.ts` defines component hooks and states.
- `components/` keeps shared component recipes. Fix appearance in the existing recipe instead of adding page-specific overrides.
- `scripts/appearance-css.ts` compiles only the default pair. `css/themes.css` is generated, not hand edited.
- `services/theme.ts` changes the root appearance class in place. It does not remount components or touch drafts, focus, selection, or scroll.
- Stored legacy style identifiers and theme files are left intact but are not loaded or rewritten.

After changing tokens or recipes, run `bun run theme:generate`, `bun run theme:check`, `bun run theme:audit`, and the relevant tests. Check both appearances, reduced motion, keyboard focus, portals, disabled/error states, and narrow layouts. Settings cancellation restores the prior appearance.
