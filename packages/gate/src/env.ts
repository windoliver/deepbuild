/** Git's location and config variables, as the issue lists them; cleared from what the gate's git inherits. */
const GIT_LOCATION = [
  'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_NAMESPACE', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_PARAMETERS',
];

/** The process's environment with git's location and config variables cleared, and `GIT_CONFIG_KEY_n`/`VALUE_n` with them. */
export function gitEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([k]) => !GIT_LOCATION.includes(k) && !/^GIT_CONFIG_(KEY|VALUE)_\d+$/.test(k)));
}
