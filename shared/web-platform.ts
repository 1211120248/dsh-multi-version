/**
 * Browser platform modules provided by the DSH Web module loader.
 * The standalone client bundle keeps these identities external and resolves
 * them from the DSH 0.1.1-rc.2 shell at runtime.
 * @module dsh-multi-version/shared/web-platform
 */

/** The module specifiers the shell shares into the frozen module table. */
export const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
] as const
