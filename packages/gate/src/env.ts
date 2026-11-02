// The environment the gate's git runs in (#31): the hub may itself be started with git's location and config
// variables set (`GIT_DIR`, `GIT_WORK_TREE`, `GIT_CONFIG_PARAMETERS`, ...), which would point every git it runs for a
// claim at another repository or apply settings the claim's repository never had. Each is cleared first; a call then
// sets only the ones it means.

/** Git's location and config variables, as the issue lists them; cleared from what the gate's git inherits. */
export const GIT_LOCATION = [
  'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_NAMESPACE', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_PARAMETERS',
];

/** The process's environment with git's location and config variables cleared, and `GIT_CONFIG_KEY_n`/`VALUE_n` with them. */
export function gitEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([k]) => !GIT_LOCATION.includes(k) && !/^GIT_CONFIG_(KEY|VALUE)_\d+$/.test(k)));
}
