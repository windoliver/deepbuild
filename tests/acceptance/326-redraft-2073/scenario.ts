// What #2073 changes of #326's watch-only scenario (REDRAFT.md): the fixture, in two places, and nothing else. #326's
// scenario (tests/acceptance/326/setup/scenario.ts, frozen and imported unchanged) has a session claim its task done
// and run the drafted check with `deep_run`, which must fail, in a repo no trust record covers whose check is `exit 1`.
// - A correct hub now refuses `deep_run` in a project no trust record covers, so a drafted check has a failed run only
//   in a project you trust. The repo here is trusted by Claude Code's own workspace trust (`~/.claude.json`), which is
//   there before DeepBuild is installed: the home still holds nothing of DeepBuild's when the click or the first `deep`
//   command runs. Trusting a project approves none of its checks (design: Untrusted repos; spec-draft's row, "with its
//   checks already run, and verdicts there are watch-only until approved").
// - A trusted project's `deep_run` now runs as a claim's checks run, and there an `exit N` is a masked exit status, so
//   its run is uncounted, never failed (design: Check health, Traced programs). The drafted check here is
//   `node checks/unit.mjs`, a script that exits 1: one Node process, which fails the same run either way.
// The scenario's steps and assertions stand as #326 wrote them.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { gitRepo, parseObject, userConfig } from '../326/setup/helpers.ts';
import { watchOnlyFromTheStart } from '../326/setup/scenario.ts';

/**
 * A repo `shop` whose `.deepbuild/done.yaml` was drafted (its one check fails) and that nobody approved, as #326's
 * `draftedRepo` makes it but for the check's command, in a project you trust: Claude Code's workspace trust for the
 * folder, as its trust dialog records it in `~/.claude.json` and as #322's suite writes it. The core's trust read
 * reuses it, so the repo needs no second answer.
 */
export function trustedDraftedRepo(home: string): { repo: string; commit: string } {
  const repo = join(dirname(home), 'shop');
  mkdirSync(join(repo, '.deepbuild'), { recursive: true });
  mkdirSync(join(repo, 'checks'));
  writeFileSync(join(repo, '.deepbuild', 'done.yaml'), '# Drafted for you; not approved yet.\nchecks:\n  unit:\n    run: node checks/unit.mjs\n');
  writeFileSync(join(repo, 'checks', 'unit.mjs'), '// The drafted check: it fails.\nprocess.exitCode = 1;\n');
  writeFileSync(join(repo, 'app.js'), 'export const header = "blue";\n');
  const commit = gitRepo(home, repo);
  writeFileSync(userConfig(home), `${JSON.stringify({ projects: { [repo]: { allowedTools: [], hasTrustDialogAccepted: true } } }, null, 2)}\n`);
  return { repo, commit };
}

/**
 * #326's scenario, in the repo you trust. A way in that left `~/.claude.json` without the repo's trust has lost the
 * fixture, which is BLOCKED, never the scenario's pass or its failure.
 */
export async function watchOnlyInATrustedRepo(home: string, repo: string, commit: string, who: string): Promise<void> {
  const config = existsSync(userConfig(home)) ? parseObject(readFileSync(userConfig(home), 'utf8')) : undefined;
  if (config?.projects?.[repo]?.hasTrustDialogAccepted !== true) {
    throw Error(`BLOCKED: after ${who} ${userConfig(home)} no longer marks ${repo} trusted in Claude Code's workspace trust, so the fixture isn't the trusted repo the scenario needs: ${existsSync(userConfig(home)) ? readFileSync(userConfig(home), 'utf8').slice(0, 600) : 'the file is gone'}`);
  }
  await watchOnlyFromTheStart(home, repo, commit, who);
}
