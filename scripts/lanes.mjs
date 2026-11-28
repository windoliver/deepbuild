import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { closeSync, copyFileSync, existsSync, globSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { homedir, hostname, tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inputs as configInputs } from './config-eval.mjs';
import { inputs as verdictInputs } from './verdict-proofs.mjs';
import { alone, byHand, exclusive, fromLaneFiles, LANE_FILE, ownLane, redrafted, slow, timed } from './lanes-lists.mjs';
// Lane definitions are imported without the build tooling by runner configs and minimal fixture repositories.
const require = createRequire(import.meta.url);

const root = fileURLToPath(new URL('../', import.meta.url));
// The repo's declared test paths. The unit lane's runners take their file patterns from them, and perf
// sets the test files a change adds or modifies apart by them.
export const testPaths = ['tests/**', 'packages/**/test/**', 'packages/**/*.test.ts', 'crates/*/tests/**'];
/** A runner's file patterns: each declared path narrowed to that runner's test files. Cargo finds its own. */
export const testGlobs = (extension) => testPaths
  .map((path) => (path.endsWith('/**') ? `${path}/*.test.${extension}` : path))
  .filter((glob) => glob.endsWith(`.test.${extension}`) && !glob.startsWith('crates/'));

// The lane lists, in lanes-lists.mjs.
export { alone, byHand, exclusive, fromLaneFiles, LANE_FILE, ownLane, redrafted, slow, timed };

// #3178: these files expect deep_ask to wait on a choice with a recommended option, which goes on at once as
// provisional (#84; the design's "Work goes on while you decide"), so they stop BLOCKED on main, and
// 27-redraft-2073/waits.test.ts's stop is never held for its ask, nor 27/outcomes-redraft/outcomes.test.ts's while a
// subagent runs. Their blind redrafts run in their place
// (tests/acceptance/667/redraft-3178/DISPUTE.md), and they are kept as written, by hand only. 27/waits.test.ts has been
// by hand since #2073 (above); its redraft-3178 also stands in for 27-redraft-2073's.
byHand.push('tests/acceptance/667/fold.test.ts', 'tests/acceptance/667/plants.test.ts', 'tests/acceptance/667/redraft-1463/',
  'tests/acceptance/27/repeat.test.ts', 'tests/acceptance/27-redraft-2073/waits.test.ts', 'tests/acceptance/27/outcomes-redraft/outcomes.test.ts',
  'tests/acceptance/111/revive.test.ts');
// #667's redraft reads `deep inbox` within a second (criteria.test.ts), INCONCLUSIVE under load, as the redrafts it
// stands beside do;
// #27's two and #111's run deep-hook from target/, whose 50 ms wait on the hub lets a call through under load, and #27's
// waits file takes over two minutes, as the file it replaces does; #3178's suite runs those folders.
timed.push('tests/acceptance/667/redraft-3178/criteria.test.ts');
alone.push('tests/acceptance/27/redraft-3178/', 'tests/acceptance/27/outcomes-redraft-3178/', 'tests/acceptance/111/redraft-3178/');
slow.push('tests/acceptance/3178/suites.test.ts');
slow.push('tests/acceptance/27/redraft-3178/waits.test.ts');
byHand.push('tests/acceptance/25/routes/held.test.ts', 'tests/acceptance/25/routes/one-route.test.ts');
Object.assign(redrafted, { 'tests/acceptance/25/routes/held.test.ts': 'tests/acceptance/25-redraft-3243/', 'tests/acceptance/25/routes/one-route.test.ts': 'tests/acceptance/25-redraft-3243/' });
byHand.push('tests/acceptance/3243/provisional.test.ts');

// #1876: the design links lane compares the design with files on main, which #2339's first draft doesn't copy into its
// scratch tree, so its planted tests stop at their control (tests/acceptance/2339/redraft-1876/DISPUTE.md). On the
// owner's ruling ("Dispute and redraft", Nov 25) its four files, kept as written, run by hand, and their blind redraft,
// which copies the whole tree, runs in their place.
byHand.push(...['ac1-planted', 'ac2-invariants', 'ac3-checks', 'ac4-canvas'].map((file) => `tests/acceptance/2339/${file}.test.mjs`));

byHand.push('tests/acceptance/3605/ac09-shown.test.ts');

// #3033's folder (blind) runs alone by its lane.json; budgets.test.ts times a sea at 1080p with judgeLimit.
timed.push('tests/acceptance/3033/budgets.test.ts');
timed.push('tests/acceptance/3454/budgets.test.mjs');
timed.push('tests/acceptance/3611/ac6-first-reply.test.mjs');

/**
 * Why each `alone` entry is alone (#3066; docs/parallel-proof.md, section 7), one reason an entry: `binary`, a sibling's
 * cargo build rewrites a binary under it (its files start cargo, read target/, or start a hub, which runs deep-hook
 * from its checkout's target/); `timing`, a load or timing gate; `shared: <resource>`, a resource it shares, which
 * keeps it alone whatever else holds. Each was read from the entry's files, its comment above, its suite's README or
 * the commit that listed it; where several hold, shared outranks timing and timing outranks binary. In an entry with
 * files the alone block runs, only those count: not the timed ones, nor those run by hand; an entry whose every file
 * is timed is `timing`. The GPU is shared by an entry with such a file that draws on the machine's GPU: through Metal
 * or GPUI's offscreen Metal renderer (its helper's gate says so), deep-gpu with no noop backend, a GPU export, or
 * WebGPU in Chrome. The sandbox log stream is shared by an entry whose files open the supervisor or start a hub that
 * runs sandboxed plug-ins, since the supervisor reads the system's one log stream. Memory and the cores are shared
 * on the owner's ruling (#3066): #2645 measures its resident memory beside a 100 MB transcript, and #2227 runs a whole
 * workspace build in a copy. An entry whose reason none of these establishes has none here until the owner names it
 * or moves it to the parallel block. scripts/alone-lint.mjs, in the lint lane, fails an entry
 * with no reason or another one, an entry that leaves `alone` with any reason but binary on the merge base, and a
 * binary one that leaves while its files still read target/, start cargo or start a hub. A new entry names its reason
 * here; a new suite's own lane.json names it as the first words of its `why`.
 * `node scripts/lanes.mjs alone --by-reason` counts them.
 */
export const aloneReasons = {};
for (const [reason, entries] of Object.entries({
  binary: [
    'tests/acceptance/2386/', 'tests/acceptance/2086-redraft-2047/', 'tests/acceptance/172-redraft-ac4/', 'tests/acceptance/1490-redraft-2892/', 'tests/acceptance/192/packs-redraft-2892/', 'tests/acceptance/2386-redraft-ac6-hashes/', 'tests/acceptance/1456-redraft-ac2-ac4/', 'tests/acceptance/323-redraft-2171/', 'tests/acceptance/2896/',
    'tests/acceptance/2700/heap.test.mjs', 'tests/acceptance/2700/equal.test.mjs', 'tests/acceptance/2700/data-row.test.mjs', 'tests/acceptance/2700/as-given.test.mjs', 'tests/acceptance/2700/reached.test.mjs',
    'tests/acceptance/1523/', 'tests/acceptance/84/', 'tests/acceptance/994/hub.test.ts', 'tests/acceptance/994/deadline-redraft/', 'tests/acceptance/20/', 'tests/acceptance/65/', 'tests/acceptance/1581/proposal.test.ts',
    'tests/acceptance/82/', 'tests/acceptance/1202/', 'tests/acceptance/55/', 'tests/acceptance/356/', 'tests/acceptance/24/', 'tests/acceptance/26/', 'tests/acceptance/1632/',
    'tests/acceptance/389/', 'tests/acceptance/394/', 'tests/acceptance/305/', 'tests/acceptance/387/', 'tests/acceptance/855/', 'tests/acceptance/857/', 'tests/acceptance/1487/',
    'tests/acceptance/488/', 'tests/acceptance/489/', 'tests/acceptance/490/', 'tests/acceptance/490-redraft-2/', 'tests/acceptance/490-oracle/',
    'tests/acceptance/3234-redraft-ac3/', 'tests/acceptance/3234-redraft-ac6/',
    'tests/acceptance/490-oracle-redraft/', 'tests/acceptance/491/', 'tests/acceptance/492/', 'tests/acceptance/492-gaps/', 'tests/acceptance/493/',
    'tests/acceptance/493-redraft-ac7/', 'tests/acceptance/493-redraft-ac12/', 'tests/acceptance/493-redraft-ac18/', 'tests/acceptance/494/', 'tests/acceptance/496/',
    'tests/acceptance/497/', 'tests/acceptance/388/', 'tests/acceptance/373/', 'tests/acceptance/160/', 'tests/acceptance/96/', 'tests/acceptance/670/', 'tests/acceptance/138/',
    'tests/acceptance/185/', 'tests/acceptance/200/', 'tests/acceptance/467-redraft-ac2/', 'tests/acceptance/221/', 'tests/acceptance/412/', 'tests/acceptance/1015/claude.test.ts',
    'tests/acceptance/1015/codex.test.ts', 'tests/acceptance/1015/focused.test.ts', 'tests/acceptance/1015/waiter.test.ts', 'tests/acceptance/1015/memory.test.ts',
    'tests/acceptance/1015/gpu.test.ts', 'tests/acceptance/1015/redraft/own-repo.test.ts', 'tests/acceptance/1018/', 'tests/acceptance/1143/', 'tests/acceptance/399/',
    'tests/acceptance/1417/', 'tests/acceptance/1417-redraft-ac1/', 'tests/acceptance/87/gate/', 'tests/acceptance/1537/', 'tests/scene3d-interface.test.ts',
    'tests/acceptance/441/', 'tests/acceptance/440/', 'tests/acceptance/433/', 'tests/acceptance/381/', 'tests/acceptance/398/', 'tests/acceptance/397/', 'tests/acceptance/415/',
    'tests/acceptance/383/', 'tests/acceptance/384/', 'tests/acceptance/400/', 'tests/acceptance/401/', 'tests/acceptance/105/', 'tests/acceptance/498/', 'tests/acceptance/402/',
    'tests/acceptance/327/', 'tests/acceptance/777/', 'tests/acceptance/856/', 'tests/acceptance/21/budgets.test.ts', 'tests/acceptance/21/process-start.test.ts',
    'tests/acceptance/884/', 'tests/acceptance/666/fast.test.ts', 'tests/acceptance/668/fast.test.ts', 'tests/acceptance/567/fast.test.ts', 'tests/acceptance/34/',
    'tests/acceptance/667/', 'tests/acceptance/371/', 'tests/acceptance/376/', 'tests/acceptance/306/', 'tests/acceptance/403/', 'tests/acceptance/18/session/',
    'tests/acceptance/18/binding/', 'tests/acceptance/18/mapping/callers.test.ts', 'tests/acceptance/18/mapping/failures.test.ts', 'tests/acceptance/18/mapping/loops.test.ts',
    'tests/acceptance/18/mapping/mcp.test.ts', 'tests/acceptance/18/mapping/prompts.test.ts', 'tests/acceptance/18/mapping/record.test.ts',
    'tests/acceptance/18/mapping/replies.test.ts', 'tests/acceptance/453/', 'tests/acceptance/1633/', 'packages/hub/test/reopened-items.test.ts', 'tests/acceptance/46/',
    'packages/github/test/', 'tests/acceptance/2078/', 'tests/acceptance/2218/', 'tests/acceptance/2648/', 'tests/acceptance/167/', 'tests/acceptance/1328/',
    'tests/acceptance/18/install/coexist.test.ts', 'tests/acceptance/18/install/disable.test.ts', 'tests/acceptance/18/install/install.test.ts',
    'tests/acceptance/18/install/stophold.test.ts', 'tests/acceptance/18/install/tamper.test.ts', 'tests/acceptance/18/install/waiter.test.ts', 'tests/acceptance/19/',
    'tests/acceptance/629/', 'tests/acceptance/25/routes/', 'tests/acceptance/25/fallbacks/', 'tests/acceptance/321/', 'tests/acceptance/303/', 'tests/acceptance/344/',
    'tests/acceptance/1514/', 'tests/acceptance/322/', 'tests/acceptance/323/', 'tests/acceptance/324/', 'tests/acceptance/325/', 'tests/acceptance/347/', 'tests/acceptance/340/',
    'tests/acceptance/29/hub.test.ts', 'tests/acceptance/29/slots.test.ts', 'tests/acceptance/907/slots.test.ts', 'tests/acceptance/907/background.test.ts',
    'tests/acceptance/965/', 'packages/hub/test/loop-starters.test.ts', 'packages/hub/test/loop-transcript.test.ts', 'tests/acceptance/1175/', 'tests/acceptance/23/permissions/',
    'tests/acceptance/83/', 'tests/acceptance/352/', 'tests/acceptance/27/wake.test.ts', 'tests/acceptance/27/repeat.test.ts', 'tests/acceptance/27/waits.test.ts',
    'tests/acceptance/27/outcomes-redraft/', 'tests/acceptance/27/desktop-redraft-2/', 'tests/acceptance/27/redraft-3178/', 'tests/acceptance/27/outcomes-redraft-3178/', 'tests/acceptance/111/redraft-3178/', 'tests/acceptance/906/', 'packages/hub/test/drive.test.ts', 'tests/acceptance/990/',
    'tests/acceptance/140/platform/', 'tests/acceptance/309/', 'tests/acceptance/874/redraft/', 'tests/acceptance/824/cycles.test.ts', 'tests/acceptance/824/planted.test.ts',
    'tests/acceptance/824/leftovers.test.ts', 'tests/acceptance/824/sessions/readings.test.ts', 'tests/acceptance/824/sessions/planted.test.ts', 'tests/acceptance/1294/',
    'tests/acceptance/1507/', 'tests/acceptance/1998/', 'tests/acceptance/1999/', 'tests/acceptance/1848/', 'tests/acceptance/2653/', 'tests/acceptance/1868-redraft-ac2/',
    'tests/acceptance/1334-redraft-2565/', 'tests/acceptance/33/', 'tests/acceptance/533/', 'tests/acceptance/194-oracle/', 'tests/acceptance/1493/word.test.ts',
    'tests/acceptance/1493/recipe.test.ts', 'tests/acceptance/1493/document.test.ts', 'tests/acceptance/1515/', 'tests/acceptance/1348/', 'tests/acceptance/505/',
    'tests/acceptance/505-oracle/', 'tests/acceptance/1653/', 'tests/acceptance/1653-redraft-ac2-flip/', 'tests/acceptance/536/', 'tests/acceptance/531-redraft-ac11/',
    'tests/acceptance/531-redraft-ac12/', 'tests/acceptance/500/', 'tests/acceptance/500-oracle/', 'tests/acceptance/545-redraft-ac3/', 'tests/acceptance/545-redraft-ac5/',
    'tests/acceptance/534/', 'tests/acceptance/1732/', 'tests/acceptance/1718/', 'tests/acceptance/1458/', 'tests/acceptance/1818/', 'tests/acceptance/1720/',
    'tests/acceptance/1718-redraft-1720/', 'tests/acceptance/1461/', 'tests/acceptance/1100/', 'tests/acceptance/2018/', 'tests/acceptance/2019/',
    'tests/acceptance/408/crossing.test.ts', 'tests/acceptance/408/overlap-covered.test.ts', 'tests/acceptance/408/cut.test.ts', 'tests/acceptance/408/module-label.test.ts',
    'tests/acceptance/503-oracle/', 'tests/acceptance/503-redraft-ac1/', 'tests/acceptance/935-oracle/', 'tests/acceptance/405/broken-fixture.test.ts',
    'tests/acceptance/405/floating-exception.test.ts', 'tests/acceptance/405/lid-sweep.test.ts', 'tests/acceptance/1936/', 'tests/acceptance/1935/',
    'tests/acceptance/1938-redraft-contrast/', 'tests/acceptance/202/', 'tests/acceptance/1971/', 'tests/acceptance/1972/', 'tests/acceptance/1973/', 'tests/acceptance/1974/',
    'tests/acceptance/2717/', 'tests/acceptance/1957/', 'tests/acceptance/1961/', 'tests/acceptance/1399/', 'tests/acceptance/2015/', 'tests/acceptance/1575/',
    'tests/acceptance/1964/', 'tests/acceptance/1965/', 'tests/acceptance/1965-oracle/', 'tests/acceptance/1963/', 'tests/acceptance/1723/', 'tests/acceptance/2205/',
    'tests/acceptance/504/', 'tests/acceptance/504-redraft-ac1/', 'tests/acceptance/504-redraft-ac2/', 'tests/acceptance/504-redraft-ac8/', 'tests/acceptance/2026/',
    'tests/acceptance/2028/', 'tests/acceptance/2021/', 'tests/acceptance/2029/', 'tests/acceptance/1101/', 'tests/acceptance/1899/', 'tests/acceptance/2009/',
    'tests/acceptance/2009-redraft-ac2/', 'tests/acceptance/2010-oracle/', 'tests/acceptance/2011/', 'tests/acceptance/547/', 'tests/acceptance/407/',
    'tests/acceptance/407-oracle/', 'tests/acceptance/2014/', 'tests/acceptance/2014-oracle/', 'tests/acceptance/1956/', 'tests/acceptance/1959/', 'tests/acceptance/1960/',
    'tests/acceptance/1962/', 'tests/acceptance/1802/', 'tests/acceptance/139-redraft-1802/', 'tests/acceptance/155-redraft-ac9/', 'tests/acceptance/1700/',
    'tests/acceptance/1781/', 'tests/acceptance/1163/', 'tests/acceptance/1164/', 'tests/acceptance/1862/', 'tests/acceptance/1958/', 'tests/acceptance/306-redraft-1958/',
    'tests/acceptance/162-oracle/', 'tests/acceptance/162-redraft-ac6/', 'tests/acceptance/1183/', 'tests/acceptance/539-oracle-redraft/', 'tests/acceptance/538/',
    'tests/acceptance/538-oracle/', 'tests/acceptance/540/', 'tests/acceptance/540-oracle/', 'tests/acceptance/1920/', 'tests/acceptance/1863/', 'tests/acceptance/2070/',
    'tests/acceptance/2070-gaps/', 'tests/acceptance/1725/', 'tests/acceptance/55-redraft-ac13/', 'tests/acceptance/1606/', 'tests/acceptance/1606-redraft-ac5-ac9/',
    'tests/acceptance/2085/', 'tests/acceptance/2362/', 'tests/acceptance/2197/', 'tests/acceptance/2144/', 'tests/acceptance/1332/', 'tests/acceptance/2120/',
    'tests/acceptance/1347/', 'tests/acceptance/1347-redraft-1812/', 'tests/acceptance/1335/', 'tests/acceptance/1342/', 'tests/acceptance/1342-redraft-1812/',
    'tests/acceptance/1345/', 'tests/acceptance/1349/', 'tests/acceptance/525/', 'tests/acceptance/204/', 'tests/acceptance/204-oracle/', 'tests/acceptance/204-redraft-ac7/',
    'tests/acceptance/204-gaps/', 'tests/look-type.test.ts', 'tests/acceptance/507/', 'tests/acceptance/507-oracle/', 'tests/acceptance/226-oracle-redraft/',
    'tests/acceptance/466-redraft-ac3/', 'tests/acceptance/222/', 'tests/acceptance/222-oracle/', 'tests/acceptance/223/', 'tests/acceptance/223-oracle/',
    'tests/acceptance/225-oracle/', 'tests/acceptance/225-oracle-redraft-ac7/', 'tests/acceptance/549-oracle/', 'tests/acceptance/549-redraft-ac2/', 'tests/acceptance/550/',
    'tests/acceptance/550-oracle/', 'tests/acceptance/551/', 'tests/acceptance/551-oracle/', 'tests/acceptance/280-redraft-ac4/', 'tests/acceptance/297/',
    'tests/acceptance/297-oracle/', 'tests/acceptance/172-redraft-ac2/', 'tests/acceptance/1969/', 'tests/acceptance/142/', 'tests/acceptance/142-redraft-ac9/',
    'tests/acceptance/142-redraft-ac10/', 'tests/acceptance/224-oracle/', 'tests/acceptance/1940/', 'tests/acceptance/1968/', 'tests/acceptance/1968-oracle/',
    'tests/acceptance/2073/', 'tests/acceptance/26-redraft-2073/', 'tests/acceptance/19-redraft-2073/', 'tests/acceptance/823-redraft-2073/', 'tests/acceptance/27-redraft-2073/',
    'tests/acceptance/16-redraft-1865/', 'tests/acceptance/213/', 'tests/acceptance/213-oracle/', 'tests/acceptance/213-redraft-ac3/', 'tests/acceptance/233/',
    'tests/acceptance/233-oracle/', 'tests/acceptance/182-oracle/controllers-py-rapier.test.ts', 'tests/acceptance/182-oracle-redraft-climb/', 'tests/acceptance/2240/',
    'tests/acceptance/2309/', 'tests/acceptance/2243/', 'tests/acceptance/2241/', 'tests/acceptance/2009-redraft-2241/', 'tests/acceptance/2239/',
    'tests/acceptance/2239-redraft-ac4/', 'tests/acceptance/2248/', 'tests/acceptance/2098/', 'tests/acceptance/2098-redraft-ac2/', 'tests/acceptance/2307/',
    'tests/acceptance/2308/', 'tests/acceptance/191-redraft-2308/', 'tests/acceptance/2371/', 'tests/acceptance/1931/', 'tests/acceptance/191-redraft-1931/',
    'tests/acceptance/192/voxel/', 'tests/acceptance/192/packs/', 'tests/acceptance/192/packs-redraft-ac12/', 'tests/acceptance/416/layouts/', 'tests/acceptance/2652/',
    'tests/acceptance/1928/', 'tests/acceptance/2650/cycles.test.ts', 'tests/acceptance/2650/planted-answers.test.ts', 'tests/acceptance/2650/planted-results.test.ts',
    'tests/acceptance/2650/planted-jobs.test.ts', 'tests/acceptance/2650/planted-names.test.ts', 'tests/acceptance/1498/', 'tests/acceptance/1812/',
    'tests/acceptance/67-redraft-1812/', 'tests/acceptance/1495/app-download.test.ts', 'tests/acceptance/1592/', 'tests/acceptance/1411/', 'tests/acceptance/1512/',
    'tests/acceptance/1509/', 'tests/acceptance/1929/', 'tests/acceptance/1826/', 'tests/acceptance/1415/', 'tests/acceptance/1430/', 'tests/acceptance/1430-redraft-ac2/',
    'tests/acceptance/2456/', 'tests/write-reveal-frames.test.ts', 'tests/web-reading-walk.test.ts', 'tests/acceptance/2776/seal.test.ts', 'tests/acceptance/2776/export.test.ts',
    'tests/acceptance/2776/listing.test.ts', 'tests/acceptance/2457/', 'tests/acceptance/2500/', 'tests/acceptance/211/', 'tests/acceptance/981/', 'tests/acceptance/189/saves/',
    'tests/acceptance/189-oracle/', 'tests/acceptance/189/lab-redraft/', 'tests/acceptance/276/record/', 'tests/acceptance/276/match/', 'tests/acceptance/2109/',
    'tests/acceptance/953/', 'tests/acceptance/953-oracle/', 'tests/acceptance/1250/', 'tests/acceptance/1576/', 'tests/acceptance/2661/', 'tests/acceptance/980/',
    'tests/acceptance/1861/', 'tests/acceptance/2897/', 'tests/acceptance/2897-redraft-ac6/', 'tests/acceptance/2697/', 'tests/acceptance/409-redraft-2697/',
    'tests/acceptance/1181/', 'tests/acceptance/1834/', 'tests/acceptance/2035/', 'tests/acceptance/2288/', 'tests/acceptance/2748/', 'tests/acceptance/1500/',
    'tests/acceptance/1500-oracle/', 'tests/acceptance/3234/', 'tests/acceptance/3234-redraft-ac3/', 'tests/acceptance/2039-oracle/',
    'tests/acceptance/1881-redraft-2047/', 'tests/acceptance/96-redraft-1412/',
  ],
  timing: [
    'tests/acceptance/2513-redraft-2047/',
    'tests/acceptance/896/', 'tests/acceptance/16/', 'tests/acceptance/1098/budgets.test.ts', 'tests/acceptance/1015/budgets.test.ts', 'tests/acceptance/1417-redraft-ac3/',
    'tests/acceptance/1022/', 'tests/acceptance/823/', 'tests/acceptance/14/budgets.test.ts', 'tests/acceptance/42/budgets.test.ts', 'tests/acceptance/62/budgets.test.ts',
    'tests/acceptance/311/redraft-ac12/budgets.test.ts', 'tests/acceptance/28/budgets.test.ts', 'tests/acceptance/319/budgets.test.ts', 'tests/acceptance/315/',
    'tests/acceptance/21/replay.test.ts', 'tests/acceptance/159/budgets.test.ts', 'tests/acceptance/761/budgets.test.ts', 'tests/acceptance/85/budgets.test.ts',
    'tests/acceptance/669/fast.test.ts', 'tests/acceptance/1156/fast.test.ts', 'tests/acceptance/2698/', 'tests/acceptance/1463/', 'tests/acceptance/25/live/budgets.test.ts',
    'tests/acceptance/29/budgets.test.ts', 'tests/acceptance/23/match/budgets.test.ts', 'tests/acceptance/120/budgets.test.ts', 'tests/acceptance/120/budgets-idle-redraft.test.ts',
    'tests/acceptance/27/budgets.test.ts', 'tests/acceptance/1868/', 'tests/acceptance/2573/', 'tests/acceptance/194-redraft-ac11/', 'tests/acceptance/1477/',
    'tests/acceptance/2569/', 'tests/acceptance/408-redraft-ac5/', 'tests/acceptance/405-redraft-ac4/', 'tests/acceptance/1405/', 'tests/acceptance/724-redraft-1405/',
    'tests/acceptance/1575-redraft-ac1/', 'tests/acceptance/2026-redraft-ac3/', 'tests/acceptance/518-redraft-ac10/', 'tests/acceptance/538-redraft-ac8/', 'tests/acceptance/269-redraft-ac6/',
    'tests/acceptance/525-device/', 'tests/acceptance/222-redraft-ac7/', 'tests/acceptance/280/', 'tests/acceptance/277/', 'tests/acceptance/556-redraft-ac5/',
    'tests/acceptance/2032-redraft-ac8/', 'tests/acceptance/1017/budgets.test.ts', 'tests/acceptance/1097/budgets.test.ts', 'tests/acceptance/111/budgets.test.ts',
    'tests/acceptance/304/budgets.test.ts', 'tests/acceptance/308/budgets.test.ts', 'tests/acceptance/31/budgets.test.ts', 'tests/acceptance/40/budgets.test.ts',
    'tests/acceptance/45/budgets.test.ts', 'tests/acceptance/572/budgets.test.ts', 'tests/acceptance/63/budgets.test.ts', 'tests/acceptance/69/budgets.test.ts',
    'tests/acceptance/103-redraft-1830/', 'tests/acceptance/365-redraft-1830/', 'tests/acceptance/262-redraft-1830/', 'tests/acceptance/761-redraft-1830/',
    'tests/acceptance/1098-redraft-1830/', 'tests/acceptance/417-redraft-1830/', 'tests/acceptance/149-redraft-1830/', 'tests/acceptance/124-redraft-1830/',
    'tests/acceptance/1427-redraft-1830/', 'tests/acceptance/311-redraft-1830/', 'tests/acceptance/1018-redraft-1830/', 'tests/acceptance/166-redraft-1830/',
    'tests/acceptance/268-redraft-1830/', 'tests/acceptance/465-redraft-1830/', 'tests/acceptance/968-redraft-1830/', 'tests/acceptance/1830/ac2-timing.test.ts',
    'tests/acceptance/1801/', 'tests/acceptance/2760-redraft-ac8/', 'tests/acceptance/2777/', 'tests/acceptance/553/',
    'tests/acceptance/980-redraft-ac9/', 'tests/acceptance/2317/', 'tests/acceptance/2740/',
    'tests/acceptance/3405/',
  ],
  'shared: Docker': [
    'tests/acceptance/580/', 'tests/acceptance/238/', 'tests/acceptance/1255/', 'tests/acceptance/194/', 'tests/acceptance/531/', 'tests/acceptance/532/', 'tests/acceptance/190/',
    'tests/acceptance/416/interfaces/', 'tests/acceptance/501-redraft-ac10/', 'tests/acceptance/1983/', 'tests/acceptance/220/', 'tests/acceptance/2010/', 'tests/acceptance/2012/',
    'tests/acceptance/2012-oracle/', 'tests/acceptance/2324/', 'tests/acceptance/225/', 'tests/acceptance/225-redraft-ac5/', 'tests/acceptance/192/dungeon/',
    'tests/acceptance/1636/', 'tests/acceptance/182/', 'tests/acceptance/2310/',
  ],
  'shared: a fixed port': [
    'tests/acceptance/331/', 'tests/acceptance/1819/', 'tests/acceptance/935/', 'tests/acceptance/509/', 'tests/acceptance/509-oracle/', 'tests/acceptance/1518/',
    'tests/acceptance/1518-redraft-ac1/',
  ],
  'shared: the GPU': [
    'tests/acceptance/1297-redraft-2047/', 'tests/acceptance/959/', 'tests/acceptance/278/', 'tests/acceptance/2892/', 'tests/acceptance/172-redraft-2892/', 'tests/acceptance/210-redraft-2892/', 'tests/acceptance/2053/',
    'tests/acceptance/149/', 'tests/acceptance/149-redraft-ac5/', 'tests/acceptance/149-redraft-ac10/', 'tests/acceptance/390/', 'tests/acceptance/391/', 'tests/acceptance/392/',
    'tests/acceptance/393/', 'tests/acceptance/854/', 'tests/acceptance/495/', 'tests/acceptance/417/', 'tests/acceptance/418/', 'tests/acceptance/464/', 'tests/acceptance/1646/',
    'tests/acceptance/1619/', 'tests/dither-fill.test.ts', 'tests/acceptance/467/', 'tests/acceptance/465/', 'tests/acceptance/166/', 'tests/acceptance/268/',
    'tests/acceptance/268-redraft-ac4/', 'tests/acceptance/968/', 'tests/acceptance/481/', 'tests/acceptance/486/', 'tests/acceptance/377/', 'tests/acceptance/378/',
    'tests/acceptance/420/', 'tests/acceptance/421/', 'tests/acceptance/423/', 'tests/acceptance/424/', 'tests/acceptance/430/', 'tests/group-compositor.test.ts',
    'tests/acceptance/446/', 'tests/acceptance/419/', 'tests/acceptance/428/', 'tests/acceptance/1297/', 'tests/acceptance/422/', 'tests/acceptance/426/', 'tests/acceptance/425/',
    'tests/acceptance/427/', 'tests/scene3d-shading.test.ts', 'tests/scene3d-contact.test.ts', 'tests/scene3d-culled-casters.test.ts', 'tests/acceptance/1640/',
    'tests/acceptance/1782/', 'tests/acceptance/443/', 'tests/acceptance/671/', 'tests/acceptance/1162/', 'tests/acceptance/406/', 'tests/acceptance/806/', 'tests/acceptance/379/',
    'tests/acceptance/1413/', 'tests/acceptance/380/', 'tests/acceptance/382/', 'tests/acceptance/386/', 'tests/acceptance/1174/', 'tests/acceptance/1173/',
    'tests/acceptance/429/', 'tests/acceptance/431/', 'tests/acceptance/432/', 'tests/acceptance/483/', 'tests/acceptance/484/', 'tests/acceptance/252/', 'tests/acceptance/1993/',
    'tests/acceptance/1312/', 'tests/acceptance/124/', 'tests/acceptance/140/gpu/', 'tests/acceptance/140/view/', 'tests/acceptance/385/', 'tests/acceptance/1285/',
    'tests/acceptance/1217/', 'tests/acceptance/2694/', 'tests/acceptance/3023/', 'tests/acceptance/1427/', 'tests/acceptance/1550/', 'tests/acceptance/1434/',
    'tests/acceptance/1482/', 'tests/acceptance/177/', 'tests/acceptance/177-redraft-ac3/', 'tests/acceptance/1436/', 'tests/acceptance/1485/', 'tests/acceptance/1486/',
    'tests/acceptance/1485-redraft-ac2/', 'tests/acceptance/1546/', 'tests/acceptance/535/', 'tests/acceptance/1479/', 'tests/acceptance/499/', 'tests/acceptance/545/',
    'tests/acceptance/1637/', 'tests/acceptance/1634/', 'tests/acceptance/501/', 'tests/acceptance/502/', 'tests/acceptance/502-oracle/', 'tests/acceptance/503/',
    'tests/acceptance/1938/machines.test.ts', 'tests/acceptance/1939/', 'tests/acceptance/2513/', 'tests/acceptance/3017/', 'tests/acceptance/456/', 'tests/acceptance/544/',
    'tests/acceptance/1976/', 'tests/acceptance/1056/', 'tests/acceptance/1897/', 'tests/acceptance/1903/', 'tests/acceptance/2189/', 'tests/acceptance/2189-redraft-ac1/',
    'tests/acceptance/2189-redraft-ac3/', 'tests/acceptance/2691/', 'tests/acceptance/1967/', 'tests/acceptance/409/', 'tests/acceptance/409-oracle/', 'tests/acceptance/1401/',
    'tests/acceptance/1729/', 'tests/acceptance/157/', 'tests/acceptance/157-oracle/', 'tests/acceptance/518/', 'tests/acceptance/537/', 'tests/acceptance/537-oracle/',
    'tests/acceptance/2017/', 'tests/acceptance/2017-redraft-ac2/', 'tests/acceptance/173/', 'tests/acceptance/450/', 'tests/acceptance/451/', 'tests/acceptance/239/',
    'tests/acceptance/169/', 'tests/acceptance/226/', 'tests/acceptance/2450/', 'tests/acceptance/462/', 'tests/look-regions-paths.test.ts', 'tests/acceptance/466/',
    'tests/acceptance/466-redraft-ac6/', 'tests/acceptance/466-redraft-ac7/', 'tests/acceptance/172/', 'tests/acceptance/172-oracle/', 'tests/acceptance/549/',
    'tests/acceptance/1041/', 'tests/acceptance/1045/', 'tests/acceptance/2856/', 'tests/acceptance/1490/', 'tests/acceptance/224/', 'tests/acceptance/468/',
    'tests/acceptance/468-redraft-ac3/', 'tests/acceptance/506/', 'tests/acceptance/506-redraft-ac5/', 'tests/acceptance/508/', 'tests/acceptance/463/', 'tests/acceptance/1040/',
    'tests/acceptance/458/pairs/', 'tests/acceptance/458/relations/', 'tests/acceptance/458/views/', 'tests/acceptance/860/', 'tests/acceptance/2516/', 'tests/acceptance/457/',
    'tests/acceptance/210/', 'tests/acceptance/2031/', 'tests/acceptance/1561/', 'tests/acceptance/2032/', 'tests/acceptance/2742/', 'tests/acceptance/1381/',
    'tests/acceptance/971/', 'tests/acceptance/1992/', 'tests/acceptance/1992-redraft-ac5/', 'tests/acceptance/1831/', 'tests/acceptance/2760/', 'tests/acceptance/732/',
    'tests/acceptance/1484/', 'tests/acceptance/806-redraft-ac3/', 'tests/acceptance/1215/', 'tests/acceptance/1489/', 'tests/acceptance/189/carry/', 'tests/acceptance/276/web/',
    'tests/acceptance/2738/', 'tests/acceptance/265/', 'tests/acceptance/3016/', 'tests/acceptance/552/', 'tests/acceptance/298/',
    'tests/acceptance/1488/', 'tests/acceptance/161/', 'tests/acceptance/2034/', 'tests/acceptance/2054/', 'tests/acceptance/3171/', 'tests/acceptance/290/',
    'tests/acceptance/2215/', 'tests/acceptance/2215-redraft-ac5/', 'tests/acceptance/3034/',
    'tests/acceptance/3507-redraft-ac2/',
    'tests/acceptance/1219/', 'tests/acceptance/231/', 'tests/acceptance/2844/', 'tests/acceptance/2844-redraft-moving/', 'tests/acceptance/3036/', 'tests/acceptance/853/',
  ],
  'shared: the Lima VMs': [
    'tests/acceptance/1942/', 'tests/acceptance/1945/', 'tests/acceptance/1946/', 'tests/acceptance/1943/', 'tests/acceptance/1942-redraft-2073/',
  ],
  "shared: the checkout's source files": [
    'tests/acceptance/1901/', 'tests/acceptance/2497/', 'tests/acceptance/2173-redraft-2047/',
  ],
  "shared: the checkout's built packages": ['tests/acceptance/2696/'],
  'shared: the sandbox log stream': [
    'tests/acceptance/3570/',
    'tests/acceptance/67/', 'tests/acceptance/66/', 'tests/acceptance/103/', 'tests/acceptance/363/', 'tests/acceptance/365/', 'tests/acceptance/262/', 'tests/acceptance/366/',
    'tests/acceptance/881/', 'tests/acceptance/411/', 'tests/acceptance/236/', 'tests/acceptance/30/', 'tests/acceptance/104/', 'tests/acceptance/989/', 'tests/acceptance/37/',
    'tests/acceptance/348/', 'tests/acceptance/349/', 'tests/acceptance/351/', 'tests/acceptance/355/', 'tests/acceptance/139/', 'tests/acceptance/996/', 'tests/acceptance/832/',
    'tests/acceptance/1731/', 'tests/acceptance/1820/', 'tests/acceptance/1922/', 'tests/acceptance/1924/', 'tests/acceptance/1923/', 'tests/acceptance/1925/',
    'tests/acceptance/154/', 'tests/acceptance/154-oracle/', 'tests/acceptance/154-redraft/', 'tests/acceptance/154-oracle-redraft/', 'tests/acceptance/155/',
    'tests/acceptance/155-oracle/', 'tests/acceptance/162/', 'tests/acceptance/184/', 'tests/acceptance/184-redraft-ac7-2/', 'tests/acceptance/555/', 'tests/acceptance/1048/',
    'tests/acceptance/556/', 'tests/acceptance/2650/retries.test.ts', 'tests/acceptance/2650/jobs.test.ts', 'tests/acceptance/2650/replay.test.ts',
    'tests/acceptance/66-redraft-1812/', 'tests/acceptance/2402/', 'tests/acceptance/2898/', 'tests/acceptance/851/', 'tests/acceptance/3035/',
    'tests/acceptance/139-redraft-2062/',
    // #3525's blind redrafts of suites that brought an asset in through deep_kinds: hubs with sandboxed fills and renders, as their originals.
    ...['1731-redraft-3525', '1820-redraft-3525', '154-redraft-3525', '154-redraft-3525b', '154-oracle-redraft-3525', '154-oracle-redraft-redraft-3525',
      '155-oracle-redraft-3525', '2123-redraft-3525', '2898-redraft-3525'].map((folder) => `tests/acceptance/${folder}/`),
  ],
  'shared: memory': ['tests/acceptance/2645/'],
  'shared: the cores': ['tests/acceptance/2227/'],
  'shared: the screen': [
    'tests/acceptance/1172/', 'tests/acceptance/1454/', 'tests/acceptance/1459/', 'tests/acceptance/1002/first-screen-redraft/', 'tests/acceptance/994/first-screen-redraft/',
    'tests/acceptance/2494/', 'tests/acceptance/1455/', 'tests/acceptance/1462/', 'tests/acceptance/1462-redraft-ac2/', 'tests/acceptance/539/', 'tests/acceptance/542/',
    'tests/acceptance/903/', 'tests/acceptance/548/', 'tests/acceptance/1808/', 'tests/acceptance/1431/', 'tests/acceptance/2403/',
    'tests/acceptance/3236/', 'tests/acceptance/3236-redraft-ac8/', 'tests/live-window-hidden.test.ts',
  ],
})) for (const entry of entries) aloneReasons[entry] = reason;
for (const entry of alone) {
  if (entry in aloneReasons || !LANE_FILE.test(`${entry}lane.json`)) continue;
  // A lane file that can't be read, or names none, leaves its folder with no reason, for the lint to name.
  let text = '';
  try { text = readFileSync(join(root, entry, 'lane.json'), 'utf8'); } catch {}
  const why = text.match(/"why"\s*:\s*"(binary\b|timing\b|shared: [^".;,]+)/);
  if (why) aloneReasons[entry] = why[1];
}

/**
 * The unit lane's alone block (see the lane): the vitest files it lists, each folder's run with no file beside it. runLanes
 * runs it as affected.mjs runs the block (#3137; docs/parallel-proof.md, section 7a), through that script's own entry:
 * `affected.mjs --alone` takes the files this command lists and runs its folders side by side, each in a shard of its
 * own, on the run's one jobserver, then the exclusive folders one at a time, and its slow and timed files in full, the
 * timed ones last, one at a time.
 */
export const aloneCommand = [process.execPath, 'node_modules/vitest/vitest.mjs', 'run', '--no-file-parallelism', ...alone, ...[...ownLane, ...byHand].flatMap((path) => ['--exclude', path.endsWith('.ts') ? path : `${path}**`])];
const sharded = [process.execPath, 'scripts/affected.mjs', '--alone', '--slow', '--timed'];
/** The command runLanes runs for a lane command: the alone block's in shards, any other as it is. */
const runOf = (command) => (command === aloneCommand ? sharded : command);

// #231's folders (blind) run alone by their lane.json; these three files read a clock and the machine's load.
timed.push('tests/acceptance/231/speed.test.ts', 'tests/acceptance/231/wall.test.ts', 'tests/acceptance/231/starts.test.ts');

export const checks = [
  { name: 'typecheck', commands: [[process.execPath, 'node_modules/typescript/bin/tsc', '--noEmit'], ['npm', 'run', 'build', '--workspaces']], fix: 'Correct the TypeScript diagnostic.' },
  { name: 'lint', commands: [['cargo', 'fmt', '--all', '--', '--check'], [process.execPath, 'scripts/repo-rules.mjs'], ['cargo', 'clippy', '--workspace', '--all-targets', '--locked', '--', '-D', 'warnings'], [process.execPath, 'scripts/vendor-rebase.mjs', 'check'], [process.execPath, 'scripts/canvas-lint.mjs'], [process.execPath, 'scripts/size-ratchet.mjs'], [process.execPath, 'scripts/wait-ratchet.mjs'], [process.execPath, 'scripts/comment-ratchet.mjs'], [process.execPath, 'scripts/doc-ceilings.mjs'], [process.execPath, 'scripts/reading-rule.mjs'], [process.execPath, 'scripts/glossary-lint.mjs'], [process.execPath, 'scripts/conformance-lint.mjs'], [process.execPath, 'scripts/slots-check.mjs'], [process.execPath, 'scripts/canvas-closures.mjs', 'closures'], [process.execPath, 'scripts/canvas-closures.mjs', 'drift'], [process.execPath, 'scripts/canvas-closures.mjs', 'paths'], [process.execPath, 'scripts/record-reader-guard.mjs'], [process.execPath, 'scripts/render-lint.mjs'], [process.execPath, 'scripts/plant-lint.mjs'], [process.execPath, 'scripts/loads-lint.mjs'], [process.execPath, 'scripts/budget-table.mjs', 'check'], [process.execPath, 'scripts/cache-lint.mjs'], [process.execPath, 'scripts/blocking-call-guard.mjs'], [process.execPath, 'scripts/ask-sources-guard.mjs'], [process.execPath, 'scripts/keymap-guard.mjs'], [process.execPath, 'scripts/color-literal-guard.mjs'], [process.execPath, 'scripts/guide.mjs', '--check'], [process.execPath, 'scripts/panel-catalog.mjs'], [process.execPath, 'scripts/known-failures-check.mjs'], [process.execPath, 'scripts/fetch-lock.mjs', 'lint'], [process.execPath, 'scripts/exit-lint.mjs'], [process.execPath, 'scripts/app-copy-lint.mjs'], [process.execPath, 'scripts/alone-lint.mjs'], [process.execPath, 'scripts/built-escapes.mjs'], [process.execPath, 'scripts/kit-ledger.mjs'], [process.execPath, 'scripts/row-sentence-lint.mjs'], [process.execPath, 'scripts/unread-exports.mjs']], fix: 'Format Rust with cargo fmt, follow the Fix line under each repo rule above, fix the clippy warnings, follow the Fix line under each canvas-lint finding, each size FAIL line, each waits FAIL line, each comments FAIL line, each doc-ceilings FAIL line, each reading rule FAIL line and each glossary FAIL line, or repair the enum closure, code mapping, rule fake or planted code each conformance-lint FAIL line names, declare the slot each slots-check FAIL line names with its interface, kit and planted fill, give each canvas list a closure-lint FAIL line names its closure or make the reference table and packages/contracts/canvas-closures.json agree where a drift FAIL line says they differ, give each holder a paths FAIL line names its line in its section\'s Paths row of docs/canvas-primitives.md saying what packages/contracts/canvas-paths.json holds (the deep-show unit test the_paths_listing_is_what_the_full_set_seals prints that file from the seal), and each same a check kind or fixture that holds it, read the record through the one reader in crates/deep-app/src/record.rs from each module a record-reader FAIL line names, put each plant read a plant FAIL line names under its cargo feature, give each judgeLimit call a loads FAIL line names its loads, rewrite benchmarks/windows/numbers.md from the window records where a budget-table FAIL line names a row (node scripts/budget-table.mjs write), move each blocking call a blocking-call FAIL line names off the UI thread or give it its reason, give each source an ask-source FAIL line names its row in packages/asks/sources.json, give each chord a keymap FAIL line names a free key, no ⌃, or the variant_of its ⌥ needs, draw each color a color-literal FAIL line names from the role it names, regenerate the extension guide with node scripts/guide.mjs, follow the Fix line under each panel-catalog FAIL line, or give each known failure a known-failures FAIL line names an open issue and the date it was added, fixing it or taking it out once 14 days have passed, or pin each scripts/fetch-lock.json row a fetch-lock FAIL line names to a commit with its sha256, size and credit, or exit with 0, 1, 2 or 3 where an exits FAIL line names a command that can exit another code, or draw each string a copy FAIL line names from a key of crates/deep-app/copy/en.json through crate::copy, its numbers through the table\'s placeholders and plural forms, or follow the Fix line under each alone FAIL line, or build again each package a built-escapes FAIL line names, so the last step of its build writes each character above U+00FF as an escape, or run the canvas kit (node scripts/canvas-kit.mjs) and commit the crates/deep-show/kit-ledger.json it writes where a kit ledger FAIL line names a module, or follow the Fix line under the row sentences FAIL lines, or drop `export` from each name an unread-exports FAIL line names, deleting it where nothing reads it.' },
  { name: 'unit', commands: [
    // The canvas, text and marks acceptance files each build a binary before spawning it, and cargo
    // clones the binary into target/debug anew on every build, fresh or not, so a file spawning it
    // while a sibling file builds finds it gone or half-written: those files run one at a time, after
    // every other file has run in parallel. The hub's files (#16) start real hubs and time their
    // sockets to 2 ms, so they too run one at a time, with nothing beside them. So does each file
    // that times an issue's frozen budget on the reference Mac (gated by environmentProblem()): #14's
    // 5,000 appends a second fell to 3,300-4,000/s beside the parallel block and passed alone. The
    // supervisor's files (#236) too: they read the system's one sandbox log stream. And deep-hook's
    // files (#315), and #666's checkpoint through it: they build it and time it to 50 ms.
    [process.execPath, 'node_modules/vitest/vitest.mjs', 'run', ...[...alone, ...ownLane, ...byHand].flatMap((path) => ['--exclude', path.endsWith('.ts') ? path : `${path}**`])],
    aloneCommand,
    // A listed failure must not prevent later targets from reporting unlisted failures.
    ['cargo', 'test', '--workspace', '--locked', '--no-fail-fast'],
    // Node's acceptance suites under tests/acceptance/ run by hand, as their READMEs say: #48's live
    // tests spend plan usage, and #246's check that change against its own base. So do tests/*.live.test.mjs,
    // as their headers say: they need release binaries the preflight never builds (#2136).
    [process.execPath, '--test', 'tests/!(*.live).test.mjs', ...testGlobs('mjs').filter((glob) => !glob.startsWith('tests/'))],
  ], fix: 'Repair the behavior named by the failing test.' },
  // #139's contract step: every published entry with its history, diffed against every earlier release in
  // contracts/releases/, a break passing only with its reviewed contracts/breaks file.
  { name: 'contracts', commands: [[process.execPath, 'scripts/contract-diff.mjs', 'check']], fix: 'Follow the Fix line under each contracts FAIL above: give the entry its since, stability, tracking issue or replaced_by, take a new major, or commit a reviewed contracts/breaks/<from>_<to>/<issue>.txt quoting each diff line and a workaround.' },
  // #139's interface diffs: cargo-semver-checks on the canvas module crates and deep-hook against HEAD, and the
  // TypeScript extension API against its committed report, so an interface change shows in the pull request that made it.
  { name: 'interfaces', commands: [[process.execPath, 'scripts/api-surface.mjs']], fix: 'Commit the API report that shows the change you meant (node scripts/api-surface.mjs --write-report), or undo the public change each FAIL api line names; install cargo-semver-checks (cargo install cargo-semver-checks --locked) for a BLOCKED api line.' },
  // The GPU layer's render logic on wgpu's noop backend, with no GPU (#377): slots and fences,
  // uploads that settle, a lost device's rebuild and submission in frame order.
  { name: 'noop', commands: [['cargo', 'test', '--locked', '-p', 'deep-gpu']], fix: 'Repair the render logic the failing noop test names.' },
  // #140: every platform seam's conformance suite on this build's backends; a suite this run can't give what it needs reads BLOCKED.
  { name: 'seams', commands: [[process.execPath, 'scripts/seams.mjs']], fix: 'Repair the backend each FAIL line names against its seam\'s suite.' },
  // #309: the relay suite on the shipped relay, and relay@1's interop run against every relay implementation.
  { name: 'relay', commands: [[process.execPath, 'scripts/relay-kit.mjs']], fix: 'Repair the relay or the backend each FAIL line names, or run the interop against the relay a protocol change left out.' },
  // #140: the canvas core's crates build for the web's platform, wasm32 with threads off, so nothing native-only creeps in.
  { name: 'wasm32', commands: [[process.execPath, 'scripts/wasm32.mjs']], fix: 'Remove the threads or the native-only API from the crate each FAIL line names, or install the target (rustup target add wasm32-unknown-unknown).' },
  // The event catalogue holds every kind the design docs and the open issues name (#605). It reads the
  // contracts package the typecheck lane builds.
  { name: 'catalogue drift', commands: [[process.execPath, 'scripts/catalogue-drift.mjs']], fix: 'Add each kind named above to the catalogue with its schema, write the name so it does not read as an event kind, or list a name that is no event kind in scripts/not-event-kinds.txt beside the open issue that names it, and remove each stale entry named above; offline, run again with network and gh signed in.' },
  // Every link from the design docs and the open issues into docs/*.md lands on a heading or an <a id> (#910), and
  // every `deep` command and agent tool an open issue names is in the design or planned (#1329). It reads the open
  // issues the catalogue drift lane fetched.
  { name: 'design links and names', commands: [[process.execPath, 'scripts/design-links.mjs']], fix: 'Point each link named above at a heading or <a id> its doc has, or give the doc back the heading it linked; add each name above to the design in code, or to scripts/planned-names.txt as `<name> #<issue>` while its design waits; remove a stale planned name; offline, run again with network and gh signed in.' },
  // Public text names no product the project only studied (#1329): the change's added lines, its commit messages and
  // the open issues, against the salted hashes in scripts/studied-names.json.
  { name: 'public text', commands: [[process.execPath, 'scripts/public-text.mjs']], fix: 'Restate each finding above in our own words, without the name; a name DeepBuild runs, links, calls, reads or writes leaves the list in its own pull request; offline, run again with network and gh signed in.' },
  // One set of plain words (#1348): the replica draws the lane's fixture run, and the card, the page, notifications
  // and the run's end notice show no word contracts/plain-words.json lists and no stack trace; a session's page and
  // what a row opens keep the real names.
  { name: 'plain words', commands: [['cargo', 'build', '--locked', '-p', 'deep-replica', '--features', 'env-plants', '--bin', 'deep-plain-words'], [`${process.env.CARGO_TARGET_DIR ?? 'target'}/debug/deep-plain-words`]], fix: 'Say each string above in the plain word it names, or move what it shows one click away to the page its row opens.' },
  // The fixture corpus (#47): every covered agent version has a recorded set holding each event its
  // facts list, each set replays clean through its adapter, and the corpus stays under 200 MB.
  { name: 'corpus', commands: [[process.execPath, 'scripts/corpus.mjs', 'check']], fix: 'Follow the Fix line under each corpus failure above.' },
  // The canvas conformance kit over the shipped canvas modules (#138): every part, headless on Vello CPU and
  // wgpu's noop backend, no GPU. It rewrites crates/deep-show/kit-ledger.json, which a release build seals by.
  // #1427: the motion check on the shipped journeys for Needs you, a session page and the project page.
  { name: 'motion', commands: [['cargo', 'build', '--locked', '-p', 'deep-replica', '--bin', 'deep-drive'], [process.execPath, 'scripts/motion.mjs']], fix: 'Make the motion each finding above names settle, fade or fly as declared,.' },
  { name: 'canvas kit', commands: [[process.execPath, 'scripts/canvas-kit.mjs']], fix: 'Repair the canvas module and part each line above names; run the kit call alone to replay a failing seed.' },
  // #2777: every field list of the sealed listing carries its closure, read from the deep-show built here, and the
  // reference's generated table says what that listing holds. The lane prints its reading of lists saying instead:
  // nothing; the reading is never a verdict.
  { name: 'field lists', commands: [['cargo', 'build', '--locked', '--bin', 'deep-show'], [process.execPath, 'scripts/canvas-closures.mjs', 'fields'], [process.execPath, 'scripts/canvas-closures.mjs', 'drift', '--built']], fix: 'Give each field list a FAIL fields line names its closure in crates/deep-canvas/src/registry/fields.json (or beside its kind), and regenerate the reference\'s field-list table with node scripts/canvas-closures.mjs table where a drift FAIL line says it differs from the listing.' },
  // #458: the parity suite's quick lane, the kit's fixtures and their planted-fault twins on Vello CPU and the noop
  // backend, no GPU, after the fixture scan over every canvas fixture and its evidence. What can't run reads BLOCKED
  // in its row, for the release bar to weigh; the lane fails on what ran and didn't hold.
  { name: 'parity suite quick', commands: [['cargo', 'build', '--locked', '--bin', 'deep-show'], [process.execPath, 'scripts/fixture-scan.mjs'], [process.execPath, 'scripts/parity-suite.mjs', 'run', 'quick']], fix: 'Remove or redact what each fixture scan line names; repair the fixture each FAIL line names, give a fixture an INVALID line names a planted-fault twin that fails, and read both results of an INCONCLUSIVE one before running it again on a new commit.' },
  // Build first, so a broken build fails this lane instead of comparing a stale binary.
  { name: 'parity quick', commands: [['cargo', 'build', '--workspace', '--locked'], [process.execPath, 'scripts/parity.mjs']], fix: 'Repair the Rust build, the CLI behavior or the cross-binary help/version mismatch.' },
  // The proof lanes (#569): the test guard, fails before on the merge base, the trace lane, and the
  // lifecycle enumerator, crash suite and verdict replay when the change touches their paths. The release
  // preflight adds the mutation lane and runs the lifecycle enumerator and crash suite in full.
  { name: 'proof', commands: [[process.execPath, 'scripts/proof.mjs', ...(process.env.DEEP_PREFLIGHT === 'release' ? ['--release'] : [])]], fix: 'Follow the Fix line under each proof lane finding above.' },
  // The verdict table in Lean (#684): the model's proofs and their axioms, then the engine against the model's
  // seeded claims and the rank-swap twins. Lean builds take a while, so the local preflight runs it only for a
  // change to what its script says it checks (#821); the release preflight always does.
  {
    name: 'verdict proofs', paths: verdictInputs,
    commands: [[process.execPath, 'scripts/verdict-proofs.mjs'], [process.execPath, 'node_modules/vitest/vitest.mjs', 'run', '--root', 'tests/acceptance/684', 'lean.test.ts', '-t', 'AC3|AC4', '--silent=false']],
    fix: 'Repair the proof or build error each FAIL line names, keeping every theorem on Lean\'s standard axioms, or make the engine and packages/verdicts/model agree on the vector named; under BLOCKED, install the toolchain as its Fix line says.',
  },
  // Configuration evals (#112): a change to an instruction file, a skill or the agents' settings lands only with a
  // replay of it on real past tasks that didn't regress. The replay spends plan usage, so you start it; this gate only
  // reads the report it left.
  {
    name: 'config eval', paths: configInputs,
    commands: [[process.execPath, 'scripts/config-eval.mjs', 'gate']],
    fix: 'Under BLOCKED, run the two commands its Fix line names; under FAIL, the change broke the tasks named, so rework it and replay it again.',
  },
];

/**
 * Lanes only the release preflight runs, after the checks and apart from their time budget: #666's spine checkpoint,
 * #668's setup checkpoint, #567's spine exit and #18's live sessions start real Claude Code sessions on your plan, and take minutes.
 */
export const releaseLanes = [
  {
    // #2403's: a shipped language with a key it lacks or a translation whose English changed since it was written.
    name: 'copy',
    commands: [[process.execPath, 'scripts/app-copy-lint.mjs', '--release']],
    fix: 'Translate each key a copy release FAIL line names again in crates/deep-app/copy/<language>.json, or confirm the translation there still reads right: node scripts/app-copy-lint.mjs confirm <language> <key> [<text>].',
  },
  {
    // #2047's: each issue closed as completed keeps a test on main naming each of its criteria; one that doesn't is
    // reopened, naming them. It reads and writes issues with your gh sign-in, and runs no test and no model.
    name: 'closed issues',
    commands: [[process.execPath, 'scripts/closed-sweep.mjs']],
    fix: 'Each BLOCKED line names an issue or a list gh could not read: check your gh sign-in (gh auth status) and run the lane again. A reopened issue closes again through its own change, with a test naming each criterion its comment names.',
  },
  {
    // #41's: every recorded budget task on this commit and on the last release, which per-change margins can't bound.
    name: 'release budgets',
    commands: [[process.execPath, 'scripts/release-budgets.mjs', '--candidate', 'HEAD']],
    fix: 'Under FAIL, the task named got slower than the last release by more than the release margin: find the change that slowed it and rework it. With no last release, tag the last shipped commit release/<version>.',
  },
  {
    // #824's: 5,000 cycles beside the merge base's, about 90 minutes, so never in the checks' time budget.
    name: 'hub churn',
    commands: [[process.execPath, 'benchmarks/hub-churn.mjs', '--merge-base']],
    fix: 'Follow the Fix line under each hub churn FAIL above; a BLOCKED run names the reading this platform cannot take.',
  },
  {
    // #824's: 1, 10 and 30 open sessions, then the merge base built and read the same way, so minutes.
    name: 'hub sessions',
    commands: [[process.execPath, 'benchmarks/hub-sessions.mjs', '--merge-base']],
    fix: 'Follow the Fix line under the hub sessions FAIL above; a BLOCKED run names the reading this platform cannot take.',
  },
  {
    // #139's ecosystem corpus: everything DeepBuild has made or shipped (contracts/corpus.json) against the candidate,
    // and the previous release's fixture package loaded and called in it. A new failure holds the release until its
    // owner marks it fixed or accepted with its break file (contracts/corpus-decisions.json).
    name: 'ecosystem corpus',
    commands: [[process.execPath, 'scripts/contract-diff.mjs', 'corpus'], [process.execPath, 'scripts/contract-diff.mjs', 'old-load']],
    fix: 'Fix the piece each new corpus failure names, or record your decision in contracts/corpus-decisions.json: fixed once it passes again, or accepted with a reviewed break file quoting its diff line and a workaround.',
  },
  {
    // #429's calibration run: deep-gpu's calibrate call times every shipped operator and the fixture graphs, each in
    // its own pass, five runs after warm-up on the reference Mac, and passes only with every estimate within 25% of
    // its measured p95; a failed run holds composed graphs, and the planted halved noise weight must fail it.
    name: 'operator calibration',
    commands: [[process.execPath, 'node_modules/vitest/vitest.mjs', 'run', '--root', 'tests/acceptance/429', '--no-file-parallelism', 'calibration.test.ts']],
    fix: 'Measure the graphs each calibration FAIL lists as outside the bound, then set the op table weights (crates/deep-canvas/src/steps.rs) or the cost constants (crates/deep-canvas-effects/src/check.rs) from the measurement; an INCONCLUSIVE run under load runs again on an idle reference Mac.',
  },
  {
    name: 'spine checkpoint',
    commands: [['env', 'DEEP_HARNESS_LIVE=1', process.execPath, 'node_modules/vitest/vitest.mjs', 'run', '--root', 'tests/acceptance/666', 'session.live.test.ts']],
    fix: 'Repair what each failing test names; a BLOCKED run names what is missing, such as a Claude Code version the adapter facts cover.',
  },
  {
    // #668's: deep setup beside your own hook, a real session in deep status with its tool calls and commit, the
    // doctor, off and on, and deep setup --undo leaving your settings byte for byte.
    name: 'setup checkpoint',
    commands: [['env', 'DEEP_HARNESS_LIVE=1', process.execPath, 'node_modules/vitest/vitest.mjs', 'run', '--root', 'tests/acceptance/668', ...(process.platform === 'linux' ? ['linux/session.live.test.ts'] : ['--exclude', 'linux/**', 'session.live.test.ts'])]],
    fix: 'Repair what each failing test names; a BLOCKED run names what is missing, such as CLAUDE_CODE_OAUTH_TOKEN from `claude setup-token` or a Claude Code version the adapter facts cover.',
  },
  {
    // #669's: a real stop that says done before the fix held and sent back with its FAIL line, the fix's PASS naming
    // its commit, deep status matching the chat, and "all done?" answered from the record.
    name: 'done gate checkpoint',
    commands: [['env', 'DEEP_HARNESS_LIVE=1', process.execPath, 'node_modules/vitest/vitest.mjs', 'run', '--root', 'tests/acceptance/669', ...(process.platform === 'linux' ? ['linux/session.live.test.ts'] : ['--exclude', 'linux/**', 'session.live.test.ts'])]],
    fix: 'Repair what each failing test names; a BLOCKED run names what is missing, such as CLAUDE_CODE_OAUTH_TOKEN from `claude setup-token` or a Claude Code version the adapter facts cover.',
  },
  {
    // #1156's: a real session's risky calls stopped before they run: an unreadable push denied, a delete staged, a
    // push held on its plan until a signed yes, a stack's stand-in and a project extension's deny. On Linux its twin,
    // linux/, where polkit confirms the yes (#70).
    name: 'risky calls checkpoint',
    commands: [['env', 'DEEP_HARNESS_LIVE=1', process.execPath, 'node_modules/vitest/vitest.mjs', 'run', '--root', 'tests/acceptance/1156', ...(process.platform === 'linux' ? ['linux/session.live.test.ts'] : ['--exclude', 'linux/**', 'session.live.test.ts'])]],
    fix: 'Repair what each failing test names; a BLOCKED run names what is missing, such as CLAUDE_CODE_OAUTH_TOKEN from `claude setup-token` or a Claude Code version the adapter facts cover.',
  },
  {
    // #567's: the spine's exit, a seeded false "done" in a real session held, sent back naming its check, and its line in the chat.
    name: 'spine exit',
    commands: [['env', 'DEEP_HARNESS_LIVE=1', process.execPath, 'node_modules/vitest/vitest.mjs', 'run', '--root', 'tests/acceptance/567', 'session.live.test.ts']],
    fix: 'Repair what the failing test names; a BLOCKED run names what is missing, such as CLAUDE_CODE_OAUTH_TOKEN from `claude setup-token` or a Claude Code version the adapter facts cover.',
  },
  {
    name: 'claude code adapter live',
    commands: [
      ['env', 'DEEP_HARNESS_LIVE=1', process.execPath, 'node_modules/vitest/vitest.mjs', 'run', '--root', 'tests/acceptance/18/mapping', 'record.live.test.ts'],
      ['env', 'DEEP_HARNESS_LIVE=1', process.execPath, 'node_modules/vitest/vitest.mjs', 'run', '--root', 'tests/acceptance/18/install', 'tamper.live.test.ts'],
      // #25's routes back into a session: the Stop hold, the waiter's wake, the next prompt and a resume's start.
      ['env', 'DEEP_HARNESS_LIVE=1', process.execPath, 'node_modules/vitest/vitest.mjs', 'run', '--root', 'tests/acceptance/25/live', 'routes.live.test.ts'],
      ['env', 'DEEP_HARNESS_LIVE=1', process.execPath, 'node_modules/vitest/vitest.mjs', 'run', '--root', 'tests/acceptance/25/live-redraft', 'ac2.live.test.ts'],
      // #27's exit criterion: an answer wakes an idle session, and a repeat in a new session is decided for you.
      ['env', 'DEEP_HARNESS_LIVE=1', process.execPath, 'node_modules/vitest/vitest.mjs', 'run', '--root', 'tests/acceptance/27', 'session.live.test.ts'],
    ],
    fix: 'Repair what each failing test names; a BLOCKED run names what is missing, such as CLAUDE_CODE_OAUTH_TOKEN from `claude setup-token` for the settings-tamper sessions.',
  },
  {
    // #458's: the parity suite's other lanes on the release commit (full on the GPU, cross on a second machine, the
    // optional oracle lanes), then the release report, which applies the bar to every fixture's rows of that commit:
    // each must-pass fixture PASS, each other PASS or BLOCKED with an owner and a reason.
    name: 'parity suite release',
    commands: [...['full', 'cross', 'oracle'].map((lane) => [process.execPath, 'scripts/parity-suite.mjs', 'run', lane]), [process.execPath, 'scripts/parity-suite.mjs', 'report']],
    fix: 'Repair the fixture each FAIL line names; a fixture the bar names needs a PASS on the release commit when it is must-pass, and otherwise a PASS or a BLOCKED row with an owner and a reason in scripts/parity-suite.json.',
  },
  {
    // #140's validation lane: the GPU fixtures once with Metal's API and shader validation on and the shader
    // translator's bounds checks off, every float target and storage buffer read back for non-finite values.
    name: 'gpu validation',
    commands: [[process.execPath, 'scripts/gpu-validation.mjs']],
    fix: 'Repair the shader each FAIL line names (an out-of-bounds access or a non-finite value it wrote); a BLOCKED line names the shader kind or the validation the lane could not run.',
  },
];

/**
 * The paths a change touches: every path that differs between the merge base with origin/main and the working
 * tree, committed or not, and new files git doesn't ignore. Null when that can't be worked out.
 */
export function changedPaths(cwd) {
  const git = (...args) => spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 2 ** 28 });
  const base = git('merge-base', 'HEAD', 'origin/main');
  if (base.status !== 0) return null;
  const diff = git('diff', '--name-only', '-z', '--no-renames', base.stdout.trim());
  const untracked = git('ls-files', '-z', '--others', '--exclude-standard');
  if (diff.status !== 0 || untracked.status !== 0) return null;
  return [...diff.stdout.split('\0'), ...untracked.stdout.split('\0')].filter(Boolean);
}
/**
 * Whether a lane's paths cover a file: a predicate, such as the `inputs` its script exports, or a list in which a
 * folder ending in `/**` matches everything under it and anything else matches itself.
 */
const covers = (paths, file) => (typeof paths === 'function' ? paths(file)
  : paths.some((path) => (path.endsWith('/**') ? file.startsWith(path.slice(0, -2)) : file === path)));
/**
 * The changed files a lane's script says it reads (its `inputs` export) that the lane's paths miss (#821); null when
 * the script can't be loaded, so what it reads is unknown. A child loads it, so runLanes stays synchronous.
 */
function missed(lane, changed, cwd) {
  const script = lane.commands.flat().find((arg) => /^scripts\/[^/]+\.mjs$/.test(arg));
  if (!script) return { files: [] };
  const code = `import { readFileSync } from 'node:fs';
    const { inputs } = await import(${JSON.stringify(pathToFileURL(join(cwd, script)).href)});
    const files = JSON.parse(readFileSync(0, 'utf8'));
    console.log(JSON.stringify(typeof inputs === 'function' ? files.filter((file) => inputs(file)) : []));`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd, input: JSON.stringify(changed), encoding: 'utf8', maxBuffer: 2 ** 28 });
  try {
    if (result.status !== 0) return null;
    const reads = JSON.parse(result.stdout.trim().split('\n').at(-1));
    return { script, files: reads.filter((file) => !covers(lane.paths, file)) };
  } catch {
    return null;
  }
}

const throttle = fileURLToPath(new URL('./throttle.mjs', import.meta.url));
const leaseScript = fileURLToPath(new URL('./lease', import.meta.url));
/** A lane command's throttle class: the vitest parallel block and node --test are test, anything else build. */
const throttleClass = ([command, ...args]) => (command === process.execPath
  && ((args[0]?.endsWith('vitest.mjs') && !args.includes('--no-file-parallelism')) || args[0] === '--test') ? 'test' : 'build');

// How a test run reads (docs/parallel-proof.md, section 10a): each test's state from its runner's report, skips against
// the `skips` list of known-failures.json, and the evidence record each lane writes. A skip is unrun, so it is never PASS.
export const named = (path, name) => `${path} › ${name}`;
/** Whether a list of files and of folders ending in `/` covers a file. */
export const listed = (list, file) => list.some((entry) => (entry.endsWith('/') ? file.startsWith(entry) : file === entry));
/** The state that stands among several: technical-design.md's precedence, and undefined when none is below PASS. */
export const worst = (states) => ['FAIL', 'INVALID', 'BLOCKED', 'INCONCLUSIVE'].find((state) => states.includes(state));
/** Whether a lane's newly found state takes over from the one it holds: only a worse one does. */
export const stands = (found, held) => Boolean(found) && (!held || worst([held.state, found.state]) !== held.state);
// A failure that names its own state keeps it, as runLanes reads one: a check that couldn't run reads BLOCKED.
const stateOf = (message = '') => message.match(/^(?:\w*Error: )?(BLOCKED|INCONCLUSIVE|INVALID)\b/)?.[1] ?? 'FAIL';

/**
 * The results in a vitest or node --test report: failures with their state, the tests that passed, by ID, and any skips
 * with their notes. `noGrant`, when the throttle ended the job with no grant, is its message: its marker is then the
 * report's only row, since one beside other rows was left by a test's own throttle, not the job's. `cut` says a line
 * didn't parse. `label` names the job, when it reads a vitest job's whole report.
 */
export function reportResults(cwd, text, label = '') {
  const failures = [], passed = [], skips = [], stack = [], rows = [];
  const path = (file) => relative(cwd, file.startsWith('file:') ? fileURLToPath(file) : file).split(sep).join('/');
  let cut = false;
  for (const [index, line] of text.split('\n').entries()) {
    if (!line) continue;
    let row;
    try { row = JSON.parse(line); } catch {
      // A line that doesn't parse, such as a record cut short with the next run on, hides whatever its records said:
      // each file it names is unknown, and the line itself answers for a record cut before its file ends.
      cut = true;
      const records = [...line.matchAll(/\{"type":"\w+","file":("(?:[^"\\]|\\.)*")(?=,)/g)];
      const ids = [...records[0]?.index === 0 ? [] : [`report line ${index + 1}`], ...new Set(records.map(([, file]) => named(path(JSON.parse(file)), '(file)')))];
      for (const id of ids) failures.push({ id, state: 'INCONCLUSIVE', message: `line ${index + 1} of the report doesn't parse` });
      continue;
    }
    rows.push(row);
    if (row.type === 'unhandled') failures.push({ id: 'vitest › unhandled error', state: 'FAIL', message: row.message });
    if (!row.file) continue;
    const file = path(row.file);
    // node --test names a test alone; its suites are the tests started around it.
    if (row.type === 'start') stack[row.nesting] = row.name;
    const name = row.nesting === undefined ? row.name : [...stack.slice(0, row.nesting), row.name].join(' › ');
    // A suite node skips whole reports none of its tests, so it stands for them.
    if (row.type === 'skip' || row.skip || row.todo) {
      if (row.type !== 'start') skips.push({ id: named(file, name), note: row.note ?? '' });
      continue;
    }
    if (row.suite) continue;
    if (row.type === 'pass') passed.push(named(file, name));
    if (row.type === 'fail') failures.push({ id: named(file, name), state: stateOf(row.error?.message), message: row.error?.message?.split('\n')[0] ?? '' });
  }
  const noGrant = rows.length === 1 && rows[0].type === 'no-grant' ? rows[0].message : undefined;
  // The vitest reporter ends its report once all of it landed; a record lost whole leaves nothing else to see.
  if (label.startsWith('vitest') && !noGrant && !text.endsWith('{"type":"end"}\n')) failures.push({ id: `${label} report`, state: 'INCONCLUSIVE', message: "the report ends before the run did, so a test's result may be missing" });
  return { failures, passed, ...(skips.length && { skips }), ...(noGrant && { noGrant }), ...(cut && { cut }) };
}

/** The workspace's crates from cargo metadata: folders, path dependencies, the names they run by, and test targets. */
export function crates(cwd) {
  const result = spawnSync('cargo', ['metadata', '--no-deps', '--format-version', '1', '--offline'], { cwd, encoding: 'utf8', maxBuffer: 1 << 28 });
  // A cargo that can't start (not on PATH) leaves no stderr, only the spawn error, which names it (#2635).
  if (result.error) throw Error(`cargo metadata failed: ${result.error.message}`);
  if (result.status !== 0) throw Error(`cargo metadata failed: ${result.stderr.trim().split('\n').at(-1)}`);
  // cargo names paths as the disk resolves them, as /private/var for /var.
  const repo = (path) => relative(realpathSync(cwd), path).split(sep).join('/');
  return JSON.parse(result.stdout).packages.map((pkg) => {
    const dir = repo(dirname(pkg.manifest_path));
    const kind = (target) => ['bin', 'test', 'bench', 'example'].find((k) => target.kind.includes(k));
    return {
      name: pkg.name, dir,
      // The folders of its targets outside it, as the [[test]] files in tests/acceptance.
      away: [...new Set(pkg.targets.map((target) => dirname(repo(target.src_path))).filter((folder) => folder !== dir && !folder.startsWith(`${dir}/`)))],
      deps: pkg.dependencies.filter((dep) => dep.path).map((dep) => dep.name),
      names: [...new Set([pkg.name, ...pkg.targets.filter((target) => target.kind.includes('bin')).map((target) => target.name)])],
      // Each target by the build file and source path cargo test's Running line names, with the argument that reruns it.
      targets: pkg.targets.map((target) => ({
        key: `${target.name.replaceAll('-', '_')} ${relative(dirname(pkg.manifest_path), target.src_path).split(sep).join('/')}`,
        rerun: `-p ${pkg.name} ${kind(target) ? `--${kind(target)} ${target.name}` : '--lib'}`,
        doc: target.kind.includes('lib') ? target.name.replaceAll('-', '_') : null,
      })),
    };
  });
}

/** Each target of the workspace by the name cargo test's Running or Doc-tests line gives it, as the arguments that rerun it. */
const rerunTargets = (workspace) => new Map(workspace.flatMap((crate) => crate.targets.flatMap((target) => [[target.key, target.rerun], ...(target.doc ? [[`doc ${target.doc}`, `-p ${crate.name} --doc`]] : [])])));

/** The target a line of cargo test's output starts, by its Running or Doc-tests line; undefined for any other line. */
function cargoTarget(line, targets) {
  const running = line.match(/^\s*Running (?:unittests )?(.+?) \(.*?deps\/(\w+)-[0-9a-f]+\)\s*$/);
  const doc = line.match(/^\s*Doc-tests (\w+)\s*$/);
  if (!running && !doc) return undefined;
  const key = running ? `${running[2]} ${running[1]}` : `doc ${doc[1]}`;
  return targets.get(key) ?? key;
}

/** The results in cargo test's output, each test by the target that reruns it, and a target that failed in no test. */
export function cargoResults(output, status, workspace) {
  // #3333: a run the throttle gave no build grant never started cargo. The throttle's first line and its exit 3 say so,
  // as its marker in a vitest report does, so the run reads as that missing grant, never as a failed test.
  const refused = status === 3 ? output.split('\n')[0].match(/^INCONCLUSIVE no grant: (.+)$/)?.[1] : undefined;
  if (refused) return { failures: [], passed: [], noGrant: refused };
  const targets = rerunTargets(workspace);
  const failures = [], passed = [], skips = [], failed = new Set();
  // #3100: a failed test reads as the state its own failure message names, so one that panics with INCONCLUSIVE: or
  // BLOCKED: reads as that. libtest gives the message in the test's block, `---- <test> stdout ----`, as the panic of
  // the test's own thread there (lines the test printed can look like one, so the last). A custom harness that runs its
  // cases on the main thread prints a case's panic just before its result line, or its message first in a
  // `---- <test> ----` block after it.
  // #3172: a custom harness that runs nothing says why in its last line, of its own name, as
  // `card_size: INCONCLUSIVE; <reason>`.
  const said = new Map(), reported = new Set();
  let target = null, block = null, next = null, uncaught = null;
  for (const line of output.split('\n')) {
    const test = line.match(/^test (.+?) \.\.\. (ok|FAILED|BLOCKED|INVALID|INCONCLUSIVE)$/);
    if (next === 'panic' || (next === 'block' && line.trim() && !test)) {
      const failure = block && failures.findLast(({ id }) => id === block.id);
      if (failure) Object.assign(failure, { state: stateOf(line), message: line });
      else if (!block) uncaught = line;
      next = null;
    }
    const header = line.match(/^---- (.+?)( stdout)? ----$/);
    if (header) block = { id: `cargo ${target} › ${header[1]}`, test: header[1], captured: Boolean(header[2]) }, next = header[2] ? null : 'block';
    else if (test || /^(?:failures:|test result: .*)$/.test(line)) block = null, next = null;
    const thread = line.match(/^thread '(.+?)'(?: \(\d+\))? panicked at .+:$/)?.[1];
    if (thread && (block ? block.captured && thread === block.test : thread === 'main')) next = 'panic';
    const started = cargoTarget(line, targets);
    if (started !== undefined) target = started;
    if (/^test /.test(line)) reported.add(target);
    // cargo names each failed target by the arguments that rerun it.
    const rerun = line.match(/(?:to rerun pass |^\s+)`(-p \S+ --\w+(?: \S+)?)`\s*$/)?.[1];
    const own = line.match(/^(\w+): (INCONCLUSIVE|BLOCKED); (.+)$/);
    if (own && target?.split(' ').at(-1) === own[1]) said.set(target, { state: own[2], message: own[3] });
    else if (line.trim() && !rerun) said.delete(target);
    if (test && test[2] === 'ok') passed.push(`cargo ${target} › ${test[1]}`);
    if (test && test[2] !== 'ok') failures.push({ id: `cargo ${target} › ${test[1]}`, ...test[2] === 'FAILED' ? { state: stateOf(uncaught ?? ''), message: uncaught ?? '' } : { state: test[2], message: '' } }), failed.add(target);
    if (test || started !== undefined) uncaught = null;
    const ignored = line.match(/^test (.+?) \.\.\. ignored(?:, (.*))?$/);
    if (ignored) skips.push({ id: `cargo ${target} › ${ignored[1]}`, note: ignored[2] ?? '' });
    // Custom harnesses report unrun cases too; a listed target must not turn those into passes.
    const unproven = line.match(/^test result: (BLOCKED|INVALID|INCONCLUSIVE)\b/)?.[1];
    if (unproven) failures.push({ id: `cargo ${target}`, state: unproven, message: line.slice(13) }), failed.add(target);
    if (rerun && !failed.has(rerun)) failures.push({ id: `cargo ${rerun}`, ...((!reported.has(rerun) && said.get(rerun)) || { state: 'FAIL', message: 'the target failed outside any test it reported' }) }), failed.add(rerun);
  }
  if (status !== 0 && !failed.size) failures.push({ id: 'cargo test', state: 'FAIL', message: output.split('\n').find((line) => /^error/.test(line)) ?? `exited ${status}` });
  return { failures, passed, ...(skips.length && { skips }) };
}

/** The tests `cargo test -- --list` names, per target, each target by the arguments that rerun it as a test's ID has it. */
function cargoList(output, workspace) {
  const targets = rerunTargets(workspace);
  const list = {};
  let target = null;
  for (const line of output.split('\n')) {
    target = cargoTarget(line, targets) ?? target;
    const test = line.match(/^(.+): test$/);
    if (test) (list[target] ??= []).push(test[1]);
  }
  return list;
}

export const lanesFolder = () => join(homedir(), '.deepbuild', 'lanes');

/**
 * The Mac's reference list of a lane on a tree, among this machine's lane records: the `list` of the Mac's own record,
 * or the `reference` a run here carried over from it when its record took that file's place. Undefined without one.
 */
function macList(lane, tree) {
  const folder = lanesFolder();
  for (const name of existsSync(folder) ? readdirSync(folder) : []) {
    if (!name.startsWith(`${tree}-`) || !name.endsWith('.json')) continue;
    let record;
    try { record = JSON.parse(readFileSync(join(folder, name), 'utf8')); } catch { continue; }
    const list = String(record?.platform).startsWith('darwin') ? record.list : record?.reference;
    if (record?.lane === lane && record.tree === tree && list && typeof list === 'object' && Object.values(list).every(Array.isArray)) return list;
  }
  return undefined;
}

/**
 * What a lane's cargo tests prove of the platform (docs/parallel-proof.md, section 3). On the Mac, the tests they list
 * are the reference a run elsewhere is compared against, the record's `list`. Elsewhere, each test of the Mac's list
 * that this run doesn't list is absent by platform, and the run is never PASS: its pass says nothing of the macOS
 * branch. The Mac's list is read from its evidence record of the same lane on the same tree, in this machine's lanes
 * folder (T7 fetches it there); without it, or with no list of this run's own, the absent tests are unknown, and the
 * run says so.
 */
function cargoPlatform(list, { lane, tree, platform }) {
  if (platform.startsWith('darwin')) return { list, unsure: [] };
  const reference = list && macList(lane, tree);
  if (!list) return { unsure: [{ id: 'cargo test', state: 'INCONCLUSIVE', message: `ran on ${platform}, not the Mac's platform, so it says nothing of the macOS branch` }] };
  if (!reference) return { unsure: [{ id: 'cargo test', state: 'INCONCLUSIVE', message: `ran on ${platform} with no Mac reference list of the ${lane} lane on tree ${tree} in ${lanesFolder()}, so the tests absent on this platform are unknown` }] };
  const absent = Object.entries(reference).flatMap(([target, names]) => names.filter((name) => !list[target]?.includes(name)).map((name) => `cargo ${target} › ${name}`));
  return { reference, absent, unsure: absent.length
    ? absent.map((id) => ({ id, state: 'INCONCLUSIVE', message: `absent on this platform (${platform}): in the Mac's reference list` }))
    : [{ id: 'cargo test', state: 'INCONCLUSIVE', message: `ran on ${platform}, not the Mac's platform, so it says nothing of the macOS branch` }] };
}

/**
 * The cargo test arguments that select only the libtest targets a command runs: a `harness = false` test target ignores
 * `--list` and runs its whole test, so it is left out, and its tests reach the list from the run's own results.
 * Null when the workspace can't be read.
 */
function libtestTargets(args, cwd) {
  const meta = spawnSync('cargo', ['metadata', '--no-deps', '--format-version', '1', '--offline'], { cwd, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (meta.status !== 0) return null;
  const picked = args.filter((_, i) => args[i - 1] === '-p');
  const tests = [], kinds = new Set(), customs = new Set();
  for (const { name, manifest_path: manifest, targets = [] } of JSON.parse(meta.stdout).packages) {
    if (picked.length && !picked.includes(name)) continue;
    let text = '';
    try { text = readFileSync(manifest, 'utf8'); } catch {}
    const custom = new Set(text.split(/^\[\[test\]\]/m).slice(1).filter((block) => /^harness\s*=\s*false/m.test(block.split(/^\[/m)[0]))
      .map((block) => block.match(/^name\s*=\s*"([^"]+)"/m)?.[1]));
    for (const { kind } of targets) kind.forEach((k) => kinds.add(k));
    custom.forEach((target) => customs.add(target));
    tests.push(...targets.filter(({ kind }) => kind.includes('test')).map(({ name: target }) => target));
  }
  const lib = [...kinds].some((kind) => kind.endsWith('lib') || kind === 'proc-macro');
  // `--test <name>` picks that name in every package, so a name any package gives a custom harness is left out whole.
  return [...lib ? ['--lib'] : [], ...kinds.has('bin') ? ['--bins'] : [], ...[...new Set(tests)].filter((target) => !customs.has(target)).flatMap((target) => ['--test', target])];
}

/** A cargo test command that runs its packages whole: it picks no target of its own and filters no test. */
const wholeRun = (args) => !args.some((arg) => arg === '--' || /^--(?:lib|bins?|tests?|doc|examples?|bench(?:es)?|all-targets)$/.test(arg));

/**
 * What a whole cargo test command lists with `-- --list`, by cargoList, under the throttle, asked with `grantWait`;
 * null when the listing fails.
 */
function cargoListed(args, cwd, env, grantWait) {
  const targets = libtestTargets(args, cwd);
  if (!targets) return null;
  const directory = mkdtempSync(join(tmpdir(), 'deep-cargo-list-')), log = join(directory, 'output');
  try {
    const descriptor = openSync(log, 'w', 0o600);
    let result;
    try {
      result = spawnSync(process.execPath, [throttle, 'build', ...grantWait, '--', leaseScript, 'cargo', ...args, ...targets, '--', '--list'], { cwd, env, stdio: ['ignore', descriptor, descriptor] });
    } finally {
      closeSync(descriptor);
    }
    return result.status === 0 ? cargoList(readFileSync(log, 'utf8'), crates(cwd)) : null;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const READING_ONLY = 'INCONCLUSIVE (reading only';
const CRITERION = /#\d+\.[0-9a-f]{8}\b/;
// A skip that says so: a platform or GPU the machine lacks. These are never listed, and leave the lane INCONCLUSIVE (platform).
// A note starting BLOCKED is a block, whatever it names: #380's M1 record names deep-gpu.
const PLATFORM = /\b(?:macOS|Linux|darwin|Metal|GPU|platform)\b/i;
export const isPlatform = (note) => !note.startsWith('BLOCKED') && PLATFORM.test(note);

/**
 * Whether a `skips` entry covers a skip: by test ID and exact note prefix, and a note-less entry only a note-less skip.
 * A reading-only skip is covered by its full note, and never in a timed file or a test carrying a criterion tag. The
 * approver, not this, confirms what an entry says of itself.
 */
function entryCovers(entry, { id, note }, timed) {
  if (entry.id !== id || isPlatform(note)) return false;
  if (note.startsWith(READING_ONLY)) return entry.note === note && !listed(timed, id.split(' › ')[0]) && !CRITERION.test(id);
  return entry.note ? note.startsWith(entry.note) : !note;
}

/** The skips as those a `skips` entry covers, printed in every summary and changing no state, and those left open. */
export function readSkips(skips, entries = [], timed = []) {
  const covered = [], open = [];
  for (const skip of skips) {
    const entry = entries.find((candidate) => entryCovers(candidate, skip, timed));
    if (entry) covered.push({ ...skip, reason: entry.reason });
    else open.push({ id: skip.id, state: skip.note.startsWith('BLOCKED') ? 'BLOCKED' : 'INCONCLUSIVE', message: skip.note || 'skipped with no note' });
  }
  return { covered, open };
}

const vitestReporter = fileURLToPath(new URL('./proof-vitest-reporter.mjs', import.meta.url));
const nodeReporter = new URL('./proof-reporter.mjs', import.meta.url).href;
/**
 * A test command with its runner's report added beside its usual output, and the environment it needs; null for any
 * other command. Only vitest's report takes the throttle's marker: node's reporter holds its file open.
 */
export function reporting([command, ...args], report) {
  const at = args.findIndex((arg) => arg.endsWith('vitest.mjs'));
  if (at >= 0) return { command: [command, ...args.slice(0, at + 2), '--reporter=default', `--reporter=${vitestReporter}`, ...args.slice(at + 2)], env: { DEEP_PROOF_VITEST_REPORT: report } };
  if (command === process.execPath && args[0] === '--test') return { command: [command, '--test', `--test-reporter=${nodeReporter}`, `--test-reporter-destination=${report}`, '--test-reporter=spec', '--test-reporter-destination=stdout', ...args.slice(1)] };
  // The alone block's run (#3137): affected.mjs writes each test's result into its --results file.
  if (command === process.execPath && args[0] === 'scripts/affected.mjs') return { command: [command, ...args, `--results=${report}`] };
  return null;
}

/** What a test command's run says of each test; null when it left nothing readable, and for any other command. */
export function testsOf([command, ...args], cwd, { report, output, status }) {
  if (command === 'cargo' && args[0] === 'test') return cargoResults(output, status, crates(cwd));
  if (!existsSync(report)) return null;
  try {
    if (args[0] === 'scripts/affected.mjs') return JSON.parse(readFileSync(report, 'utf8')).tests ?? null;
    const results = reportResults(cwd, readFileSync(report, 'utf8'), args.some((arg) => arg.endsWith('vitest.mjs')) ? 'vitest' : '');
    if (results.cut) return null;
    // vitest's -t leaves every other test skipped with no note: a filter's choice, not a skip.
    return args.includes('-t') ? { ...results, skips: results.skips?.filter(({ note }) => note) } : results;
  } catch {
    return null;
  }
}

/** The test files a command of a lane runs, as its runner takes them; none for one that names no file, as `cargo test`. */
function testFilesOf(cwd, command) {
  const named = require('./proof-binaries.mjs').commandFiles(cwd, command).flatMap((path) => (path.includes('*') ? globSync(path, { cwd }) : [path]));
  return named.map((file) => relative(realpathSync(cwd), realpathSync(resolve(cwd, file))).split(sep).join('/'));
}

function knownFailures(cwd) {
  try {
    return JSON.parse(readFileSync(join(cwd, 'scripts/known-failures.json'), 'utf8'));
  } catch {
    return {};
  }
}

/**
 * One command's run in a lane: each test's state, unproven tests and listed skips/failures. Only exact FAIL IDs can
 * be listed; BLOCKED, INVALID and INCONCLUSIVE remain unproven. A run that failed only by listed tests or tests
 * naming their own state stands on those. A runner killed outright doesn't.
 */
export function readRun(results, status, cwd, timed) {
  const { failures = [], passed = [], skips = [], noGrant } = results ?? {};
  const baseline = knownFailures(cwd);
  const { covered, open } = readSkips(skips, baseline.skips, timed);
  const known = failures.filter(({ id, state }) => state === 'FAIL' && Object.hasOwn(baseline.failures ?? {}, id));
  const listedFailures = new Map(known.map(({ id }) => [id, baseline.failures[id]]));
  const stated = failures.filter(({ state }) => state !== 'FAIL'), unsure = [...stated, ...open];
  const row = ({ id, state, message }) => state === 'FAIL' && listedFailures.has(id) ? { id, state: 'LISTED', note: listedFailures.get(id) } : { id, state, note: message };
  return {
    tests: [...passed.map((id) => ({ id, state: 'PASS' })), ...failures.map(row), ...open.map((skip) => ({ ...row(skip), skipped: true })), ...covered.map(({ id, note }) => ({ id, state: 'LISTED', note, skipped: true }))],
    unsure, covered: [...covered, ...known.map(({ id, message }) => ({ id, note: message, reason: listedFailures.get(id) }))],
    explained: status !== null && status < 128 && (Boolean(noGrant) || (failures.length > 0 && stated.length + known.length === failures.length)),
    found: noGrant ? { state: 'INCONCLUSIVE', error: noGrant } : unsure.length ? { state: worst(unsure.map(({ state }) => state)), error: `${unsure.length} ${unsure.length === 1 ? 'test' : 'tests'} proved nothing` } : undefined,
  };
}

/**
 * The tree hash of what is on disk, uncommitted and untracked files too: HEAD's tree on a clean checkout. A copy of the
 * index, so a lane's run never touches the real one. Null outside a git repository.
 */
export function exactTree(cwd) {
  const git = (args, env) => spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...env } });
  const index = git(['rev-parse', '--git-path', 'index']);
  if (index.status !== 0) return null; // Outside git: no tree, so no record. A tree git can't write reads undefined.
  const directory = mkdtempSync(join(tmpdir(), 'deep-lane-tree-')), copy = { GIT_INDEX_FILE: join(directory, 'index') };
  try {
    // Git rechecks a file only if it isn't older than the index, so a copy aged now would hide a same-size edit.
    // A repository nothing was added to has no index yet, and `git add -A` starts one.
    const source = resolve(cwd, index.stdout.trim());
    if (existsSync(source)) {
      copyFileSync(source, copy.GIT_INDEX_FILE);
      utimesSync(copy.GIT_INDEX_FILE, statSync(source).atime, statSync(source).mtime);
    }
    const written = git(['add', '-A'], copy).status === 0 ? git(['write-tree'], copy) : { status: 1 };
    return written.status === 0 ? written.stdout.trim() : undefined;
  } catch {
    return undefined;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/**
 * A tree's lane records merged as remote lanes merge (parallel-proof §8): each lane's records, a Mac's and any other
 * machine's, merge per test ID. A row that ran stands over a skipped row of the same ID, and among the rows that ran the
 * worst state stands, so a Spark FAIL wins over a Mac pass. A record's `findings`, and a state its rows and findings
 * don't explain, count as they are. A lane with no Mac record is never PASS, and another machine's lint record is a reading, left out. The
 * tree's state is the worst of its lanes' (`states`), and `lanes` names each lane holding it.
 */
export function mergeRecords(tree) {
  const folder = join(homedir(), '.deepbuild', 'lanes');
  const records = (existsSync(folder) ? readdirSync(folder) : [])
    .filter((name) => name.startsWith(`${tree}-`) && name.endsWith('.json'))
    .map((name) => JSON.parse(readFileSync(join(folder, name), 'utf8')));
  // A state the lanes don't write is no pass.
  const read = (state) => (['PASS', 'LISTED', 'FAIL', 'INVALID', 'BLOCKED', 'INCONCLUSIVE'].includes(state) ? state : 'INVALID');
  const states = {};
  for (const lane of new Set(records.map((r) => r.lane))) {
    const mac = records.filter((r) => r.lane === lane && String(r.platform).startsWith('darwin'));
    const group = lane === 'lint' ? mac : records.filter((r) => r.lane === lane);
    // A lane only Macs ran reads as it did before any merge: its records' own states.
    if (mac.length && group.length === mac.length) {
      states[lane] = worst(mac.map((r) => read(r.state))) ?? 'PASS';
      continue;
    }
    // Each record's rows by ID first: within one record a skipped row and a row that ran stay what that lane read.
    const rows = new Map(), own = [];
    for (const r of group) {
      const tests = (r.tests ?? []).map((row) => ({ ...row, state: read(row.state) })), findings = (r.findings ?? []).map((found) => read(found.state));
      for (const id of new Set(tests.map((row) => row.id))) {
        const same = tests.filter((row) => row.id === id);
        rows.set(id, [...(rows.get(id) ?? []), { state: worst(same.map((row) => row.state)), skipped: same.every((row) => row.skipped) }]);
      }
      // What a lane found outside any test, and a state neither that nor its rows explain, count whatever the rows merge to.
      own.push(...findings, ...(read(r.state) === (worst([...tests.map((row) => row.state), ...findings]) ?? 'PASS') ? [] : [read(r.state)]));
    }
    const merged = [...rows.values()].map((same) => worst((same.some((row) => !row.skipped) ? same.filter((row) => !row.skipped) : same).map((row) => row.state)));
    states[lane] = worst([...merged, ...own, ...(mac.length ? [] : ['INCONCLUSIVE'])]) ?? 'PASS';
  }
  const state = worst(Object.values(states)) ?? 'PASS';
  return { tree, state, lanes: Object.keys(states).filter((lane) => states[lane] === state), states };
}

/** A lane's evidence record, which T7 and T8 read: its state, where it ran, on what tree, and each test's state. */
export function writeRecord(lane, state, tree, tests, more = {}) {
  if (!tree) throw new Error("git can't write this checkout's tree");
  const { file, record } = recordOf(lane, state, tree, tests, more);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  return file;
}
const recordOf = (lane, state, tree, tests, more = {}) => ({
  file: join(lanesFolder(), `${tree}-${lane.replace(/\W+/g, '-')}.json`),
  record: { lane, state, host: hostname(), platform: `${process.platform}-${process.arch}`, tree, tests, ...more },
});

/**
 * What of the unit lane has no kept result to stand on for `key`'s tree: the test files, and `cargo test` when its job has
 * none, with how many files the lane has. The preflight finishes only once there are none (#3297).
 */
export function unrunOf(key, cwd = root) {
  const { openKept } = require('./proof-kept.mjs'), lane = checks.find(({ name }) => name === 'unit');
  const kept = openKept(key, (row) => readSkips([row], knownFailures(cwd).skips, timed).covered.length > 0);
  const files = lane.commands.map((command) => testFilesOf(cwd, command));
  const unrun = files.flatMap((names, index) => (names.length ? names.filter((file) => !kept.done(file)) : kept.jobDone(`unit ${index}`, []) ? [] : ['cargo test']));
  return { unrun, of: files.flat().length };
}

export function runLanes(lanes, { cwd = root, kept: key, fill = false, tree: treeOf, stall } = {}) {
  const failures = [];
  // A remote lane's far end passes its stall bound: each grant then waits while its class's grants change hands (#3350).
  // Every other run waits 30 minutes, as section 6's table says.
  const grantWait = stall === undefined ? ['--wait', '30'] : ['--stall', String(stall)];
  // Loaded only for the preflight, as a copy of this script stands alone without it.
  const { openKept, wholeJob } = key ? require('./proof-kept.mjs') : {};
  // The release preflight runs every lane; the local one runs a lane with paths only for a change that touches them.
  const release = process.env.DEEP_PREFLIGHT === 'release';
  // The lanes that read the open issues share one fetch a run, in this file (scripts/open-issues.mjs); perf's
  // copies name theirs.
  const issues = process.env.DEEP_OPEN_ISSUES ? undefined : mkdtempSync(join(tmpdir(), 'deep-open-issues-'));
  if (issues) process.env.DEEP_OPEN_ISSUES = join(issues, 'open-issues.json');
  // Never forward a shell's binary directory, even to a lane that starts its own proof.
  const environment = { ...process.env };
  delete environment.DEEP_BIN_DIR;
  let changed, binaries, built = [], binaryError;
  // Each command runs in spawnSync, so this process can't answer a signal while it runs: a watcher outside its group
  // stops the whole tree if this process dies, and writes the lane's record INCONCLUSIVE naming what it stopped, when
  // no record of the lane's tree is there yet (#3433).
  const { watchTree } = require('./proof-stop.mjs'), stop = watchTree();
  if (stop.error) console.log(`NOTE lanes: ${stop.error}, so a stop of this run may leave its commands running`);
  try {
    const selected = [];
    for (const lane of lanes) {
      if (lane.paths && !release) {
        changed ??= changedPaths(cwd);
        // A lane skips only when its script reads none of the change either.
        if (changed && !changed.some((file) => covers(lane.paths, file))) {
          const misses = missed(lane, changed, cwd);
          if (misses?.files.length) {
            failures.push(`FAIL ${lane.name}: its paths miss ${misses.files.join(', ')}, which ${misses.script} reads\n  Fix: Take the lane's paths from the inputs ${misses.script} exports.`);
            continue;
          }
          if (misses) {
            console.log(`SKIP ${lane.name}: the change touches no file it reads`);
            continue;
          }
        }
      }
      selected.push(lane);
    }
    for (const lane of selected) {
      const started = performance.now();
      console.log(`RUN ${lane.name}`);
      let failure = lane.commands.length ? undefined : { state: 'BLOCKED', error: 'No check was run' };
      // perf's copy of a commit isn't a checkout of it, so it names its tree (#3297); else the one on disk.
      const tree = treeOf ?? exactTree(cwd), tests = [], unproven = [], listedTests = [], findings = [];
      // The tests the lane's whole cargo test commands list, or null once a listing failed; whether any cargo test ran.
      let listedCargo, cargoRan = false, keptRead = 0;
      // What the watcher writes should this process die while the lane's commands run: its rows so far, INCONCLUSIVE.
      const armLane = () => {
        if (!tree) return stop.arm();
        const { file, record } = recordOf(lane.name, 'INCONCLUSIVE', tree, tests, findings.length ? { findings } : {});
        stop.arm(file, record);
      };
      // The preflight's kept results of this very tree (#3296): a job already done is read, never run again.
      let kept = key && lane.name === 'unit' && key.tree === tree ? openKept(key, (row) => readSkips([row], knownFailures(cwd).skips, timed).covered.length > 0) : null, testFiles = [];
      if (kept) try { testFiles = lane.commands.map((command) => testFilesOf(cwd, command)); } catch (error) {
        console.log(`NOTE ${lane.name}: its files can't be listed, so nothing of it is kept or read: ${error.message}`);
        kept = null;
      }
      // A command's jobs, the timed files it lists each a job of its own under its own timed grant (#3297).
      const jobs = lane.commands.flatMap((listedCommand, index) => {
        const [command, ...rest] = runOf(listedCommand), shards = rest[0] === 'scripts/affected.mjs', names = testFiles[index] ?? [];
        const whole = { command, rest, shards, names, job: `${lane.name} ${index}`, cls: throttleClass([command, ...rest]) };
        const own = kept && !shards ? names.filter((file) => listed(timed, file)) : [], vitest = rest[0]?.endsWith('vitest.mjs');
        if (!own.length) return [whole];
        const others = names.filter((file) => !own.includes(file));
        const apart = own.map((file) => ({ ...whole, names: [file], job: `${whole.job} ${file}`, cls: 'timed', rest: vitest ? [rest[0], 'run', '--no-file-parallelism', '--testTimeout=600000', file] : ['--test', file] }));
        return [...others.length ? [{ ...whole, names: others, rest: vitest ? [...rest, ...own.flatMap((file) => ['--exclude', file])] : ['--test', ...others] }] : [], ...apart];
      });
      for (const { command, rest, shards, names, job, cls } of jobs) {
        // The alone block's own run keeps its jobs, and reads them (affected.mjs).
        const args = kept && shards ? [...rest, `--kept=${JSON.stringify(key)}`] : rest;
        let directory, descriptor, result, results, output = '';
        try {
          armLane();
          const prior = kept && !shards && kept.jobDone(job, names) ? kept.results(names, job) : null;
          if (prior) keptRead += names.length;
          if (prior) [results, result, output] = [prior, { status: prior.failures.length ? 1 : 0 }, `KEPT ${job}: ${prior.passed.length + prior.failures.length + prior.skips.length} results read from an earlier run of this tree`];
          else {
            directory = mkdtempSync(join(tmpdir(), 'deep-preflight-output-'));
            const log = join(directory, 'output'), report = join(directory, 'report');
            const reported = reporting([command, ...args], report);
            // Built for the run once, and again whenever a cleanup has emptied them since (#3296).
            if (reported && !binaryError && (!binaries || built.some((name) => !existsSync(join(binaries, 'bin', name))))) {
              try {
                const { binaryNames, buildBinaries, commandFiles, watchBinaries } = require('./proof-binaries.mjs');
                if (!binaries) {
                  binaries = mkdtempSync(join(tmpdir(), 'deep-lane-binaries-'));
                  watchBinaries(binaries);
                  built = binaryNames(cwd, selected.flatMap((lane) => lane.commands.map(runOf)).flatMap((command) => commandFiles(cwd, command)));
                }
                buildBinaries(cwd, join(binaries, 'bin'), built, undefined, { timeout: 0 });
              } catch (error) { binaryError = error; }
            }
            if (reported && binaryError) throw binaryError;
            descriptor = openSync(log, 'w', 0o600);
            // One shared descriptor preserves the child's stdout/stderr write order.
            // Through the machine's throttle table, by its class (docs/parallel-proof.md, section 6), and under a cpu.slot
            // of the calling session's through scripts/lease (#1015).
            // The fill holds no grant over the alone block's own run, whose admission and turns are its jobs' (#3297).
            const began = performance.now(), leased = [leaseScript, ...reported?.command ?? [command, ...args]];
            result = spawnSync(...fill && shards ? [leased[0], leased.slice(1)] : [process.execPath, [throttle, cls, ...grantWait, '--', ...leased]], { cwd, env: { ...environment, ...reported?.env, ...reported && binaries ? { DEEP_BIN_DIR: join(binaries, 'bin') } : {} }, stdio: ['ignore', descriptor, descriptor] });
            output = readFileSync(log, 'utf8').trim();
            results = testsOf([command, ...args], cwd, { report, output, status: result.status });
            if (kept && shards) try { keptRead += JSON.parse(readFileSync(report, 'utf8')).kept?.read ?? 0; } catch {}
            if (kept && !shards) {
              if (wholeJob({ label: 'vitest', status: result.status, output, results })) kept.keep(job, names, results, performance.now() - began);
              // An earlier run's rows stand beside this one's, and a failure over a later pass.
              results = kept.overlay(results, names, job);
            }
          }
        } catch (error) {
          result = { status: null, error };
        } finally {
          try {
            if (descriptor !== undefined) closeSync(descriptor);
            if (directory) rmSync(directory, { recursive: true, force: true });
          } catch (error) {
            result = { status: null, error };
          }
        }
        if (output) console.log(output);
        const run = readRun(results, result.status, cwd, timed);
        tests.push(...run.tests);
        unproven.push(...run.unsure);
        listedTests.push(...run.covered);
        let found = run.found;
        if (result.status !== 0 && !run.explained) {
          const lines = output.split('\n').map((line) => line.trim()).filter(Boolean);
          // A test run's first error is its first failing test, as its runner's report names it: an output line can't
          // stand in, since a coloured assertion misses the pattern and a line the lease prints matches the fallback (#12).
          const failed = run.tests.find(({ state }) => state === 'FAIL');
          const error = result.error?.message
            ?? (failed && `${failed.id}${failed.note ? `: ${failed.note}` : ''}`)
            ?? lines.find((line) => /\b(?:[a-z]*error(?:\[[^\]]+\])?|fatal):|\berror TS\d+:|panicked at/i.test(line))
            ?? lines.find((line) => /\berror\b|AssertionError|panicked|\bFAIL\b|\bBLOCKED\b|\bINVALID\b|\bINCONCLUSIVE\b/i.test(line))
            ?? lines[0] ?? `${command} exited ${result.signal ?? result.status}`;
          // A diagnostic that names its own state keeps it: a check that couldn't run reads BLOCKED, not
          // FAIL, and one that couldn't read all it checks reads INCONCLUSIVE.
          const [, state, rest] = error.match(/^(FAIL|INVALID|BLOCKED|INCONCLUSIVE)\s+(.+)/) ?? [];
          found = { state: state ?? (result.error ? 'BLOCKED' : 'FAIL'), error: rest ?? error, lone: !failed };
        }
        // What no test's row carries, as a missing grant or a runner that died, is the lane's own finding: the record
        // names it, so a merge with another machine's rows (parallel-proof §8) can't lose it.
        if (found && (found.lone || (results?.noGrant && found.error === results.noGrant) || !run.tests.some(({ state }) => state === found.state))) findings.push({ state: found.state, note: found.error });
        if (stands(found, failure)) failure = found;
        // Armed again with this job's rows, for what runs after it (cargo's listing, the next job's builds).
        armLane();
        // A run the throttle refused ran nothing to list, and listing it would ask the throttle again (#3333).
        if (command === 'cargo' && args[0] === 'test' && !results?.noGrant) {
          cargoRan = true;
          const listing = wholeRun(args) && listedCargo !== null ? cargoListed(args, cwd, environment, grantWait) : undefined;
          if (listing) {
            listedCargo ??= {};
            for (const [target, names] of Object.entries(listing)) listedCargo[target] = [...new Set([...listedCargo[target] ?? [], ...names])];
            // A doc-test and a `harness = false` target's tests are known only from the run: `--list` never names them.
            for (const [, target, name] of run.tests.map(({ id }) => id.match(/^cargo (.+?) › (.+)$/)).filter(Boolean)) if (!Object.hasOwn(listing, target)) (listedCargo[target] ??= []).push(name);
          } else if (listing === null) listedCargo = null;
        }
      }
      // The record names the tree the lane started on, so a run that changed it proved another tree (#3336).
      const after = tree && exactTree(cwd);
      if (tree && after !== tree) {
        const paths = after ? spawnSync('git', ['diff-tree', '-r', '--name-only', tree, after], { cwd, encoding: 'utf8' }).stdout.trim().split('\n').filter(Boolean) : [];
        const found = { state: 'FAIL', error: `the run changed the tree it started on: ${paths.length ? paths.join(', ') : "git can't write the tree after it"}; write to a temporary folder, never the checkout` };
        findings.push({ state: found.state, note: found.error });
        if (stands(found, failure)) failure = found;
        else console.log(`FAIL ${lane.name}: ${found.error}`);
      }
      // The Mac's cargo tests are the reference list; a run elsewhere lists the tests it lacks and is never PASS (#1121).
      const more = {}, absentIds = new Set(), mac = process.platform === 'darwin';
      let platformRead = [];
      // The Mac's own tests stand without their list: a run elsewhere then finds no reference, and says so.
      if (listedCargo === null && mac) console.log(`NOTE ${lane.name}: cargo could not list the tests, so its record holds no reference list`);
      else if (listedCargo === null) platformRead = [{ id: 'cargo test -- --list', state: 'BLOCKED', message: 'cargo could not list the tests, so this platform\'s list is unknown' }];
      else if (cargoRan) {
        const read = cargoPlatform(listedCargo, { lane: lane.name, tree, platform: `${process.platform}-${process.arch}` });
        if (read.list) more.list = read.list;
        // Carried over, since this record takes the place of the Mac's when T7 fetched that to this lane's file.
        if (read.reference) more.reference = read.reference;
        for (const id of read.absent ?? []) absentIds.add(id);
        platformRead = read.unsure;
      }
      if (platformRead.length) {
        unproven.push(...platformRead);
        tests.push(...platformRead.map(({ id, state, message }) => ({ id, state, note: message, ...(absentIds.has(id) && { skipped: true }) })));
        const found = { state: worst(platformRead.map(({ state }) => state)), error: absentIds.size ? `${absentIds.size} of the Mac's cargo tests are absent on this platform` : platformRead[0].message };
        if (stands(found, failure)) failure = found;
      }
      if (kept) {
        const files = testFiles.flat(), ran = new Set(tests.filter(({ id, state }) => !id.endsWith(' › (file)') || state === 'FAIL').map(({ id }) => id.split(' › ')[0]));
        const unrun = files.filter((file) => !ran.has(file));
        if (unrun.length) {
          const found = { state: 'INCONCLUSIVE', error: `${unrun.length} of ${files.length} test files have no result on this tree: ${unrun.slice(0, 10).join(', ')}${unrun.length > 10 ? ', …' : ''}` };
          console.log(`UNRUN ${lane.name}: ${found.error}`);
          findings.push({ state: found.state, note: found.error });
          if (stands(found, failure)) failure = found;
        }
      }
      const elapsed = ((performance.now() - started) / 1000).toFixed(2);
      for (const { id, note, reason } of listedTests) console.log(`LISTED ${id}${note ? `: ${note}` : ''} (${reason})`);
      const platform = failure?.state === 'INCONCLUSIVE' && unproven.some(({ message }) => isPlatform(message)) ? ' (platform)' : '';
      const lines = unproven.map(({ id, state, message }) => `  ${state} ${id}${message ? `: ${message}` : ''}\n`).join('');
      if (failure) failures.push(`${failure.state} ${lane.name}${platform}: ${failure.error}\n${lines}  Fix: ${lane.fix}\n  Elapsed: ${elapsed} s`);
      else console.log(`PASS ${lane.name} (${elapsed} s)`);
      try {
        stop.disarm();
        if (tree !== null) writeRecord(lane.name, failure?.state ?? 'PASS', tree, tests, { ...more, ...findings.length && { findings }, ...kept && { kept: { read: keptRead, of: testFiles.flat().length } } });
      } catch (error) {
        // A lane that FAILed, or read INVALID or BLOCKED, keeps its one verdict: the missing record outranks only less.
        if (failure && failure.state !== 'INCONCLUSIVE') console.log(`NOTE ${lane.name}: no evidence record: ${error.message}`);
        else failures.push(`BLOCKED ${lane.name}: no evidence record: ${error.message}\n  Fix: Clear what that names, then run the lane again.`);
      }
    }
  } finally {
    stop.disarm();
    if (binaries) rmSync(binaries, { recursive: true, force: true });
    if (issues) {
      delete process.env.DEEP_OPEN_ISSUES;
      rmSync(issues, { recursive: true, force: true });
    }
  }
  for (const failure of failures) console.log(failure);
  return failures.length ? 1 : 0;
}

// node scripts/lanes.mjs alone --by-reason: the alone entries per reason (#3066), and those with none.
if (process.argv[2] === 'alone' && process.argv[3] === '--by-reason' && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const counts = new Map();
  for (const entry of alone) counts.set(aloneReasons[entry] ?? 'no reason', (counts.get(aloneReasons[entry] ?? 'no reason') ?? 0) + 1);
  console.log('| Reason | Entries |\n|---|---|');
  for (const [reason, count] of [...counts].sort(([a], [b]) => a.localeCompare(b))) console.log(`| ${reason} | ${count} |`);
  console.log(`\n${alone.length} alone entries.`);
}
