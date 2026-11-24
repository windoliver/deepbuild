// Planted /usr/bin/time reports for #1421: macOS `time -l` and GNU `time -f 'peak_rss_kb=%M\ncpu_s=%U %S'`,
// as scripts/benchmark.mjs's measureOnce asks for them, with the CPU line set or left out.
const rss = { darwin: '             950272  maximum resident set size\n                  0  average shared memory size\n', linux: 'peak_rss_kb=928\n' };
const cpu = { darwin: (user, sys) => `        0.01 real         ${user} user         ${sys} sys\n`, linux: (user, sys) => `cpu_s=${user} ${sys}\n` };

export const platforms = ['darwin', 'linux'];
export const report = (platform, user, sys) => platform === 'darwin' ? cpu.darwin(user, sys) + rss.darwin : rss.linux + cpu.linux(user, sys);
export const noCpuLine = (platform) => rss[platform];
export const budget = { id: 'preflight', margin: 0.5, limits: {} };

// What a call gave: its value, or the message it refused with, so a test asserts on either.
export function outcome(call) {
  try {
    return { value: call() };
  } catch (error) {
    return { error: error.message };
  }
}
