// The variables you give this suite by hand, read before anything else loads (README, Disputes D1): every file of the
// suite imports this module first. tests/acceptance/29/helpers.ts, which this suite imports through ../29/h-d.ts,
// deletes every CLAUDE* and DEEP_* variable from process.env as it loads, which would leave DEEP_PASEO_CLI, DEEP_PI_CLI,
// DEEP_PASEO_PLANT and DEEP_HUB_PLANT unread. This suite's readers take them from `given`; `restore()` puts them back
// for the imported helpers that read process.env when called (#40's piCli, #27's childEnv for DEEP_HUB_PLANT).
const NAMES = ['DEEP_PASEO_CLI', 'DEEP_PI_CLI', 'DEEP_PASEO_PLANT', 'DEEP_HUB_PLANT'] as const;
type Name = (typeof NAMES)[number];
export const given: Readonly<Partial<Record<Name, string>>> = Object.freeze(Object.fromEntries(NAMES.flatMap((n) => (process.env[n] ? [[n, process.env[n]!]] : []))));
/** Puts the given variables back into process.env, after ../29's helpers deleted them. */
export function restore(): void {
  for (const [name, value] of Object.entries(given)) process.env[name] = value;
}
