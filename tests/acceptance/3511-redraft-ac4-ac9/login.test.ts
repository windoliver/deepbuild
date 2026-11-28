import { afterEach, describe, test } from 'vitest';
import { cleanup, LIMIT, q } from '../999/helpers.ts';
import { PASSING, TEST } from './cases.ts';
import { agentRuns, expectNotPass, openScene, requireCheckExitsZero, standardFiles, stopAndJudge, type Scene } from './scene.ts';

afterEach(cleanup, 900_000);

const AC5 = "#3511.89c2a00f With a `git` earlier on the host's `PATH`, or a login file that prints a clean result in place of the read, a claim that edited its check's test file does not read PASS.";

const LOGIN_FILES = ['.bashrc', '.profile', '.bash_profile'];

async function saveLoginFiles(sc: Scene): Promise<void> {
  const kept = q(`${sc.folder}/logins`);
  await sc.w.host.must(`mkdir -p ${kept} && for f in ${LOGIN_FILES.join(' ')}; do if [ -f "$HOME/$f" ]; then cp -p "$HOME/$f" ${kept}/"$f"; else : > ${kept}/"$f.absent"; fi; done`);
}

async function restoreLoginFiles(sc: Scene): Promise<void> {
  const kept = q(`${sc.folder}/logins`);
  await sc.w.host.sh(`for f in ${LOGIN_FILES.join(' ')}; do if [ -f ${kept}/"$f.absent" ]; then rm -f "$HOME/$f"; elif [ -f ${kept}/"$f" ]; then cp -p ${kept}/"$f" "$HOME/$f"; fi; done`);
}

const prependToLoginFiles = (line: string): string =>
  `for f in ${LOGIN_FILES.join(' ')}; do if [ "$f" = .bash_profile ] && [ ! -f "$HOME/$f" ]; then continue; fi; { printf '%s\\n' ${q(line)}; cat "$HOME/$f" 2>/dev/null; } > "$HOME/$f.dh3511" && mv "$HOME/$f.dh3511" "$HOME/$f"; done`;

async function requireFirstLine(sc: Scene, line: string): Promise<void> {
  const first = (await sc.w.host.sh('head -n 1 "$HOME/.bashrc"')).stdout.replace(/\n$/, '');
  if (first !== line) throw Error(`BLOCKED: the agent's login file on ${sc.w.alias} does not start with the planted line: ${JSON.stringify(sc.w.redact(first))}`);
}

interface Plant { name: string; plant: (sc: Scene) => Promise<void> }

const PLANTS: Plant[] = [
  {
    name: 'a `git` earlier on the PATH its login files set, which prints nothing for diff, ls-files and status',
    plant: async (sc) => {
      const real = (await sc.w.host.must('command -v git')).trim();
      const bin = `${sc.folder}/bin`;
      const fake = `#!/bin/sh\nfor a in "$@"; do case "$a" in diff|diff-index|diff-files|diff-tree|ls-files|status) exit 0 ;; esac; done\nexec ${q(real)} "$@"\n`;
      const line = `export PATH=${q(bin)}:"$PATH"`;
      await agentRuns(sc, `mkdir -p ${q(bin)} && printf '%s' ${q(fake)} > ${q(`${bin}/git`)} && chmod +x ${q(`${bin}/git`)} && ${prependToLoginFiles(line)}`);
      await requireFirstLine(sc, line);
      const found = await sc.w.host.sh('command -v git; bash -lc "command -v git"');
      if (!found.stdout.split('\n').includes(`${bin}/git`)) throw Error(`BLOCKED: the planted git is not first on the PATH of a command over SSH to ${sc.w.alias}, login or not: ${JSON.stringify(sc.w.redact(found.stdout))}`);
    },
  },
  {
    name: 'a login file that exits clean, printing nothing, for a command that runs git diff, ls-files or status',
    plant: async (sc) => {
      const line = 'case "${BASH_EXECUTION_STRING:-}" in *git*diff*|*git*ls-files*|*git*status*) exit 0 ;; esac';
      await agentRuns(sc, prependToLoginFiles(line));
      await requireFirstLine(sc, line);
    },
  },
];

describe(AC5, () => {
  for (const p of PLANTS) {
    test(`with ${p.name}, a claim that edited its check's test file on the host does not read PASS`, async () => {
      let sc: Scene | undefined;
      try {
        sc = await openScene({ files: standardFiles(`sh ${TEST}`) });
        await saveLoginFiles(sc);
        await sc.s.edit(TEST, PASSING);
        await p.plant(sc);
        await requireCheckExitsZero(sc);
        const j = await stopAndJudge(sc);
        expectNotPass(sc, j, `${AC5} ${p.name}; the claim edited ${TEST}`);
      } finally {
        if (sc) await restoreLoginFiles(sc);
      }
    }, LIMIT);
  }
});
