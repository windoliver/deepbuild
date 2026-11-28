import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

export const ownLane = ['tests/acceptance/684/lean.test.ts'];
export const alone = ['tests/acceptance/149/', 'tests/acceptance/1523/', 'tests/acceptance/149-redraft-ac5/', 'tests/acceptance/149-redraft-ac10/', 'tests/acceptance/84/', 'tests/acceptance/580/', 'tests/acceptance/67/', 'tests/acceptance/66/', 'tests/acceptance/994/hub.test.ts', 'tests/acceptance/994/deadline-redraft/', 'tests/acceptance/20/', 'tests/acceptance/65/', 'tests/acceptance/1581/proposal.test.ts', 'tests/acceptance/82/', 'tests/acceptance/1202/', 'tests/acceptance/55/', 'tests/acceptance/103/', 'tests/acceptance/363/', 'tests/acceptance/365/', 'tests/acceptance/262/', 'tests/acceptance/366/', 'tests/acceptance/356/', 'tests/acceptance/24/', 'tests/acceptance/26/', 'tests/acceptance/1632/', 'tests/acceptance/389/', 'tests/acceptance/390/', 'tests/acceptance/391/', 'tests/acceptance/392/', 'tests/acceptance/393/', 'tests/acceptance/394/', 'tests/acceptance/305/', 'tests/acceptance/387/', 'tests/acceptance/855/', 'tests/acceptance/857/', 'tests/acceptance/854/', 'tests/acceptance/1487/', 'tests/acceptance/896/', 'tests/acceptance/881/', 'tests/acceptance/411/', 'tests/acceptance/488/', 'tests/acceptance/489/', 'tests/acceptance/490/', 'tests/acceptance/490-redraft-2/', 'tests/acceptance/490-oracle/', 'tests/acceptance/490-oracle-redraft/', 'tests/acceptance/491/', 'tests/acceptance/492/', 'tests/acceptance/492-gaps/', 'tests/acceptance/493/', 'tests/acceptance/493-redraft-ac7/', 'tests/acceptance/493-redraft-ac12/', 'tests/acceptance/493-redraft-ac18/', 'tests/acceptance/494/', 'tests/acceptance/495/', 'tests/acceptance/496/', 'tests/acceptance/497/', 'tests/acceptance/388/', 'tests/acceptance/16/', 'tests/acceptance/373/', 'tests/acceptance/160/', 'tests/acceptance/96/', 'tests/acceptance/670/', 'tests/acceptance/138/', 'tests/acceptance/185/', 'tests/acceptance/200/', 'tests/acceptance/417/', 'tests/acceptance/418/', 'tests/acceptance/464/', 'tests/acceptance/1646/', 'tests/acceptance/1619/', 'tests/dither-fill.test.ts', 'tests/acceptance/467/', 'tests/acceptance/467-redraft-ac2/', 'tests/acceptance/465/', 'tests/acceptance/166/', 'tests/acceptance/268/', 'tests/acceptance/268-redraft-ac4/', 'tests/acceptance/968/', 'tests/acceptance/481/', 'tests/acceptance/486/', 'tests/acceptance/221/', 'tests/acceptance/412/', 'tests/acceptance/1098/budgets.test.ts', 'tests/acceptance/1015/claude.test.ts', 'tests/acceptance/1015/codex.test.ts', 'tests/acceptance/1015/focused.test.ts', 'tests/acceptance/1015/waiter.test.ts', 'tests/acceptance/1015/memory.test.ts', 'tests/acceptance/1015/gpu.test.ts', 'tests/acceptance/1015/redraft/own-repo.test.ts', 'tests/acceptance/1015/budgets.test.ts', 'tests/acceptance/1018/', 'tests/acceptance/1143/', 'tests/acceptance/399/', 'tests/acceptance/1417/', 'tests/acceptance/1417-redraft-ac1/', 'tests/acceptance/1417-redraft-ac3/', 'tests/acceptance/87/gate/', 'tests/acceptance/1537/', 'tests/acceptance/1022/',
  'tests/acceptance/236/', 'tests/acceptance/30/', 'tests/acceptance/377/', 'tests/acceptance/378/', 'tests/acceptance/420/', 'tests/acceptance/421/', 'tests/acceptance/423/', 'tests/acceptance/424/', 'tests/acceptance/430/', 'tests/group-compositor.test.ts', 'tests/acceptance/446/', 'tests/acceptance/419/', 'tests/acceptance/428/', 'tests/acceptance/1297/', 'tests/acceptance/1297-redraft-2047/', 'tests/acceptance/422/', 'tests/acceptance/426/', 'tests/acceptance/425/', 'tests/acceptance/427/', 'tests/scene3d-interface.test.ts', 'tests/scene3d-shading.test.ts', 'tests/scene3d-contact.test.ts', 'tests/scene3d-culled-casters.test.ts', 'tests/acceptance/441/', 'tests/acceptance/440/', 'tests/acceptance/1640/', 'tests/acceptance/1782/', 'tests/acceptance/443/', 'tests/acceptance/433/', 'tests/acceptance/671/', 'tests/acceptance/1162/', 'tests/acceptance/381/', 'tests/acceptance/398/', 'tests/acceptance/397/', 'tests/acceptance/406/', 'tests/acceptance/238/', 'tests/acceptance/415/', 'tests/acceptance/383/', 'tests/acceptance/384/', 'tests/acceptance/400/', 'tests/acceptance/401/', 'tests/acceptance/105/', 'tests/acceptance/498/', 'tests/acceptance/806/', 'tests/acceptance/402/', 'tests/acceptance/104/', 'tests/acceptance/989/', 'tests/acceptance/327/', 'tests/acceptance/379/', 'tests/acceptance/1413/', 'tests/acceptance/777/', 'tests/acceptance/823/', 'tests/acceptance/856/', 'tests/acceptance/14/budgets.test.ts', 'tests/acceptance/42/budgets.test.ts', 'tests/acceptance/62/budgets.test.ts', 'tests/acceptance/311/redraft-ac12/budgets.test.ts', 'tests/acceptance/28/budgets.test.ts',
  'tests/acceptance/319/budgets.test.ts', 'tests/acceptance/331/', 'tests/acceptance/37/', 'tests/acceptance/315/', ...['replay', 'budgets', 'process-start'].map((f) => `tests/acceptance/21/${f}.test.ts`), 'tests/acceptance/348/', 'tests/acceptance/349/', 'tests/acceptance/351/', 'tests/acceptance/355/', 'tests/acceptance/884/', 'tests/acceptance/139/',
  'tests/acceptance/159/budgets.test.ts', 'tests/acceptance/761/budgets.test.ts', 'tests/acceptance/85/budgets.test.ts', 'tests/acceptance/666/fast.test.ts', 'tests/acceptance/668/fast.test.ts', 'tests/acceptance/567/fast.test.ts', 'tests/acceptance/669/fast.test.ts', 'tests/acceptance/1156/fast.test.ts', 'tests/acceptance/34/', 'tests/acceptance/667/', 'tests/acceptance/380/', 'tests/acceptance/382/', 'tests/acceptance/386/', 'tests/acceptance/1174/', 'tests/acceptance/1173/', 'tests/acceptance/371/', 'tests/acceptance/376/', 'tests/acceptance/306/', 'tests/acceptance/403/', 'tests/acceptance/429/', 'tests/acceptance/431/', 'tests/acceptance/432/', 'tests/acceptance/483/', 'tests/acceptance/484/', 'tests/acceptance/252/', 'tests/acceptance/1993/',
  'tests/acceptance/18/session/', 'tests/acceptance/18/binding/', ...['callers', 'failures', 'loops', 'mcp', 'prompts', 'record', 'replies'].map((f) => `tests/acceptance/18/mapping/${f}.test.ts`),
  'tests/acceptance/453/',
  'tests/acceptance/1633/', 'packages/hub/test/reopened-items.test.ts',
  'tests/acceptance/46/', 'packages/github/test/',
  'tests/acceptance/1172/', 'tests/acceptance/2078/', 'tests/acceptance/2218/', 'tests/acceptance/2698/', 'tests/acceptance/2648/',
  'tests/acceptance/1454/',
  'tests/acceptance/1459/',
  'tests/acceptance/1463/',
  'tests/acceptance/1002/first-screen-redraft/',
  'tests/acceptance/994/first-screen-redraft/',
  'tests/acceptance/167/', 'tests/acceptance/1328/',
  ...['coexist', 'disable', 'install', 'stophold', 'tamper', 'waiter'].map((f) => `tests/acceptance/18/install/${f}.test.ts`), 'tests/acceptance/19/',
  'tests/acceptance/1312/',
  'tests/acceptance/629/',
  'tests/acceptance/25/routes/', 'tests/acceptance/25/fallbacks/', 'tests/acceptance/25/live/budgets.test.ts', 'tests/acceptance/321/', 'tests/acceptance/303/', 'tests/acceptance/344/', 'tests/acceptance/1514/', 'tests/acceptance/322/', 'tests/acceptance/323/', 'tests/acceptance/324/', 'tests/acceptance/325/', 'tests/acceptance/347/', 'tests/acceptance/340/',
  'tests/acceptance/29/hub.test.ts', 'tests/acceptance/29/slots.test.ts', 'tests/acceptance/907/slots.test.ts', 'tests/acceptance/907/background.test.ts', 'tests/acceptance/965/', 'tests/acceptance/996/', 'packages/hub/test/loop-starters.test.ts', 'packages/hub/test/loop-transcript.test.ts', 'tests/acceptance/29/budgets.test.ts',
  'tests/acceptance/1175/',
  'tests/acceptance/23/permissions/', 'tests/acceptance/23/match/budgets.test.ts', 'tests/acceptance/83/', 'tests/acceptance/120/budgets.test.ts', 'tests/acceptance/120/budgets-idle-redraft.test.ts',
  'tests/acceptance/352/',
  ...['wake', 'repeat', 'waits', 'budgets'].map((f) => `tests/acceptance/27/${f}.test.ts`), 'tests/acceptance/27/outcomes-redraft/', 'tests/acceptance/27/desktop-redraft-2/', 'tests/acceptance/124/', 'tests/acceptance/906/', 'packages/hub/test/drive.test.ts',
  'tests/acceptance/990/',
  'tests/acceptance/140/gpu/', 'tests/acceptance/140/view/', 'tests/acceptance/140/platform/', 'tests/acceptance/309/', 'tests/acceptance/385/', 'tests/acceptance/874/redraft/',
  ...['cycles', 'planted', 'leftovers', 'sessions/readings', 'sessions/planted'].map((f) => `tests/acceptance/824/${f}.test.ts`), 'tests/acceptance/1285/', 'tests/acceptance/1294/', 'tests/acceptance/1507/', 'tests/acceptance/1998/', 'tests/acceptance/1999/', 'tests/acceptance/1848/', 'tests/acceptance/2653/', 'tests/acceptance/1868/', 'tests/acceptance/1868-redraft-ac2/',
  'tests/acceptance/1334-redraft-2565/'];

export const LANE_FILE = /^tests\/acceptance\/(\d+)(-[a-z0-9-]*(?:redraft|oracle)[a-z0-9-]*)?\/(?:([a-z0-9-]*(?:redraft|oracle)[a-z0-9-]*)\/)?lane\.json$/;
function laneLists(text, folder, isFile) {
  let lane;
  try { lane = JSON.parse(text); } catch { return null; }
  if (!lane || typeof lane !== 'object' || Array.isArray(lane) || lane.alone !== true || typeof lane.why !== 'string' || !lane.why.trim()) return null;
  if (Object.keys(lane).some((key) => !['alone', 'why', 'timed', 'slow'].includes(key))) return null;
  const names = (key) => lane[key] ?? [];
  const fits = (list) => Array.isArray(list) && list.every((name) => typeof name === 'string' && /^(?!\.{1,2}(?:\/|$))(?:[\w.-]+\/)*[\w.-]+\.test\.(?:ts|mjs|js)$/.test(name) && !name.split('/').includes('..') && isFile(`${folder}${name}`));
  return fits(names('timed')) && fits(names('slow')) ? { timed: names('timed').map((name) => `${folder}${name}`), slow: names('slow').map((name) => `${folder}${name}`) } : null;
}
const suites = join(root, 'tests/acceptance');
const isFile = (path) => statSync(join(root, path), { throwIfNoEntry: false })?.isFile() ?? false;
const laneFolders = [];
export const fromLaneFiles = { alone: [], timed: [], slow: [] };
for (const folder of existsSync(suites) ? readdirSync(suites, { withFileTypes: true }) : []) {
  if (!folder.isDirectory() || !/^\d+(?:-[a-z0-9-]*(?:redraft|oracle)[a-z0-9-]*)?$/.test(folder.name)) continue;
  const at = `tests/acceptance/${folder.name}/`;
  const subfolders = readdirSync(join(suites, folder.name), { withFileTypes: true }).filter((sub) => sub.isDirectory()).map((sub) => `${at}${sub.name}/`);
  for (const entry of [at, ...subfolders]) if (LANE_FILE.test(`${entry}lane.json`) && isFile(`${entry}lane.json`)) laneFolders.push(entry);
}
const unread = ['tests/acceptance/231-oracle/'];
for (const entry of laneFolders) if (!unread.includes(entry) && !alone.includes(entry)) alone.push(entry), fromLaneFiles.alone.push(entry);

export const slow = [
  'packages/conformance/src/slots/environment.test.ts', 'packages/hub/test/loop-starters.test.ts',
  'packages/hub/test/reopened-items.test.ts', 'tests/acceptance/1633/reopened.test.ts',
  'packages/hub/test/loop-transcript.test.ts', 'packages/pi/test/guards.test.ts',
  'tests/acceptance/1002/cli.test.ts', 'tests/acceptance/1002/screens.test.ts',
  'tests/acceptance/1002/twins.test.ts', 'tests/acceptance/1015/claude.test.ts',
  'tests/acceptance/1017/floor.test.ts', 'tests/acceptance/1017/placement.test.ts',
  'tests/acceptance/1017/toolchains.test.ts', 'tests/acceptance/1113/before.test.mjs',
  'tests/acceptance/1114/lanes.test.mjs', 'tests/acceptance/1117/proofs.test.mjs',
  'tests/acceptance/112/eval.test.ts', 'tests/acceptance/1162/present.test.ts',
  'tests/acceptance/1162/query.test.ts', 'tests/acceptance/1297/convex-sun.test.ts',
  'tests/acceptance/138/release.test.ts', 'tests/acceptance/138/shipped.test.ts',
  'tests/acceptance/139/apisurface.test.ts', 'tests/acceptance/140/gpu/features.test.ts',
  'tests/acceptance/149/taste.test.ts', 'tests/acceptance/16/address.test.ts',
  'tests/acceptance/16/hotpath-ac18-redraft.test.ts', 'tests/acceptance/185/kit.test.ts',
  'tests/acceptance/185/redraft/kit-behavior-redraft.test.ts', 'tests/acceptance/19/doctor/redraft-ac16/contract.test.ts',
  'tests/acceptance/200/fillers.test.ts', 'tests/acceptance/200/gpu.test.ts', 'tests/acceptance/200/listing.test.ts',
  'tests/acceptance/200/module.test.ts', 'tests/acceptance/200/opening.test.ts',
  'tests/acceptance/262/retention.test.ts', 'tests/acceptance/27/desktop-redraft-2/desktop.test.ts',
  'tests/acceptance/27/outcomes-redraft/outcomes.test.ts', 'tests/acceptance/27/waits.test.ts',
  'tests/acceptance/30/claims.test.ts', 'tests/acceptance/30/mask.test.ts', 'tests/acceptance/31/assertion.test.ts',
  'tests/acceptance/31/base-runs.test.ts', 'tests/acceptance/31/snapshot.test.ts',
  'tests/acceptance/314/kits.test.ts', 'tests/acceptance/315/failopen.test.ts',
  'tests/acceptance/316/corpus.test.ts', 'tests/acceptance/326/setup/click.test.ts',
  'tests/acceptance/340/app/authority.test.ts', 'tests/acceptance/372/frame.test.ts',
  'tests/acceptance/379/perf-lane.test.ts', 'tests/acceptance/402/backpressure.test.ts',
  'tests/acceptance/412/listing.test.ts', 'tests/acceptance/415/navgraph.test.ts',
  'tests/acceptance/417/state.test.ts', 'tests/acceptance/419/velocity-seek.test.ts',
  'tests/acceptance/42/doctor.test.ts', 'tests/acceptance/422/showpiece-fixture.test.ts',
  'tests/acceptance/424/picks.test.ts', 'tests/acceptance/425/redraft/taste.test.ts',
  'tests/acceptance/48/harness.test.mjs', 'tests/acceptance/484/forest.test.ts', 'tests/acceptance/484/redraft-1637/forest.test.ts',
  'tests/acceptance/674/default.test.ts', 'tests/acceptance/674/document.test.ts',
  'tests/acceptance/674/nearest.test.ts', 'tests/acceptance/674/session.test.ts',
  'tests/acceptance/824/cycles.test.ts', 'tests/acceptance/85/hub/network.test.ts',
  'tests/acceptance/855/hash.test.ts', 'tests/acceptance/86/concurrent.test.ts',
  'tests/acceptance/910/ac1-issue-link.test.mjs', 'tests/acceptance/910/ac2-renamed-heading.test.mjs',
  'tests/acceptance/910/ac3-offline.test.mjs', 'tests/acceptance/965/background.test.ts',
  'tests/acceptance/965/grace.test.ts', 'tests/acceptance/965/starts.test.ts', 'tests/acceptance/992/agree.test.ts',
  'tests/live-instancers.test.ts', 'tests/scene3d-interface.test.ts', 'tests/acceptance/2648/instructions.test.ts', 'tests/acceptance/2648/seen.test.ts',
  ...['held', 'judged', 'restart', 'plants', 'heap'].map((f) => `tests/acceptance/2653/${f}.test.ts`),
  'packages/checks/test/catalog.test.ts', 'tests/acceptance/1325/gate-secret.test.ts', 'tests/acceptance/1457/release.test.ts',
  'tests/acceptance/1480/upload.test.ts', 'tests/acceptance/1634/key-lights.test.ts', 'tests/acceptance/1634/no-pipeline.test.ts',
  'tests/acceptance/1662/ac2-symbols.test.ts', 'tests/acceptance/191/ac9-trial.test.ts', 'tests/acceptance/1918/ac2-rigid-fixtures.test.ts',
  'tests/acceptance/1918/ac3-column-view.test.ts', 'tests/acceptance/1921/ac5-seek-columns.test.ts', 'tests/acceptance/1937/estimate.test.ts',
  'tests/acceptance/1937/fix.test.ts', 'tests/acceptance/1941/fix.test.ts', 'tests/acceptance/2013/ac2-rest-on.test.ts',
  'tests/acceptance/2018/states.test.ts', 'tests/acceptance/2977/extension-host.test.ts', 'tests/acceptance/33/failure-modes.test.ts',
  'tests/acceptance/33/rows.test.ts', 'tests/acceptance/399/kit.test.ts', 'tests/acceptance/425/climb.test.ts',
  'tests/acceptance/425/hold.test.ts', 'tests/acceptance/449/ac3-turbulence-table.test.ts', 'tests/acceptance/46/unguarded.test.ts',
  'tests/acceptance/485/registries.test.ts', 'tests/acceptance/509-oracle/transcriber.test.ts', 'tests/acceptance/522-oracle/snapshot-roundtrip.test.ts',
  'tests/acceptance/522/ac3-module-inputs.test.ts', 'tests/acceptance/522/ac7-late-joint.test.ts', 'tests/acceptance/524/ac4-skins.test.ts',
  'tests/acceptance/524/ac6-soft-cube.test.ts', 'tests/acceptance/824/leftovers.test.ts', 'tests/acceptance/824/planted.test.ts',
  'tests/acceptance/980/ac10-taste.test.ts',
  'tests/acceptance/3562/order.test.ts', 'tests/acceptance/3562/unchanged.test.ts',
];
export const exclusive = ['tests/acceptance/16/', 'tests/acceptance/315/', 'tests/acceptance/236/'];
export const byHand = ['tests/acceptance/46/live.test.ts', 'tests/acceptance/685/', 'tests/acceptance/70/', 'tests/proof/70/', 'tests/acceptance/1202/session.live.test.ts', 'tests/acceptance/666/session.live.test.ts', 'tests/acceptance/668/session.live.test.ts', 'tests/acceptance/567/session.live.test.ts', 'tests/acceptance/669/session.live.test.ts', 'tests/acceptance/1156/session.live.test.ts', 'tests/acceptance/1156/linux/', 'tests/acceptance/668/linux/', 'tests/acceptance/669/linux/', 'tests/acceptance/18/mapping/record.live.test.ts', 'tests/acceptance/18/install/tamper.live.test.ts', 'tests/acceptance/21/sessions.live.test.ts',
  'tests/acceptance/25/live/routes.live.test.ts', 'tests/acceptance/25/live-redraft/ac2.live.test.ts', 'tests/acceptance/112/live.test.ts', 'tests/acceptance/27/session.live.test.ts', 'tests/acceptance/27/desktop.test.ts', 'tests/acceptance/27/desktop-redraft/', 'tests/acceptance/27/outcomes.test.ts', 'tests/acceptance/806/live.test.ts',
  'tests/acceptance/124/ac1-agents.live.test.ts', 'tests/acceptance/124/ac5-budgets.live.test.ts', 'tests/proof/883/', 'tests/proof/994/', 'tests/acceptance/366/ac1-build.live.test.ts', 'tests/acceptance/140/gpu/color.live.test.ts',
  'tests/acceptance/140/gpu/capture.live.test.ts', ...['empty', 'invalid', 'starts'].map((f) => `tests/acceptance/874/${f}.test.ts`),
  'tests/acceptance/824/budgets.long.test.ts', 'tests/acceptance/824/redraft-ac1/budgets.long.test.ts', 'tests/acceptance/824/sessions/budgets.long.test.ts',
  'tests/acceptance/824/sessions/redraft-readings/', 'tests/acceptance/14/ac6-redraft.test.ts', 'tests/acceptance/37/assertions.test.ts',
  'tests/acceptance/37/budgets.test.ts', 'tests/acceptance/37/receipt-first-draft.test.ts', 'tests/acceptance/1015/own-repo.test.ts', 'tests/acceptance/1016/',
  'tests/acceptance/994/app.test.ts', 'tests/acceptance/994/taste.test.ts', 'tests/acceptance/1632/answers.test.ts', 'tests/acceptance/19/doctor/contract.test.ts',
  ...['crash', 'misjudge', 'hold'].map((f) => `tests/acceptance/1334/${f}.test.mjs`)];

export const timed = [
  'tests/acceptance/1018/budgets.test.ts', 'tests/acceptance/1018/redraft-ac6/budgets.test.ts', 'tests/acceptance/46/budgets.test.ts',
  'tests/acceptance/103/budgets.test.ts', 'tests/acceptance/104/budgets.test.ts',
  'tests/acceptance/105/budgets.test.ts', 'tests/acceptance/105/live.test.ts',
  'tests/acceptance/1097/budgets.test.ts', 'tests/acceptance/1098/budgets.test.ts',
  'tests/acceptance/111/budgets.test.ts', 'tests/acceptance/1113/load.test.mjs', 'tests/acceptance/112/live.test.ts',
  'tests/acceptance/120/budgets-idle-redraft.test.ts', 'tests/acceptance/120/budgets.test.ts',
  'tests/acceptance/124/ac5-budgets.live.test.ts', 'tests/acceptance/138/budgets.test.ts',
  'tests/acceptance/139/budgets.test.ts', 'tests/acceptance/14/budgets.test.ts',
  'tests/acceptance/140/platform/budgets.test.ts', 'tests/acceptance/140/view/access.test.ts',
  'tests/acceptance/140/view/parity-planted-redraft.test.ts', 'tests/acceptance/140/view/parity.test.ts',
  'tests/acceptance/140/view/timing.test.ts', 'tests/acceptance/15/budgets.test.ts',
  'tests/acceptance/159/budgets.test.ts', 'tests/acceptance/16/budgets.test.ts', 'tests/acceptance/1632/budgets.test.ts',
  'tests/acceptance/18/kit/budgets.test.ts', 'tests/acceptance/185/budgets.test.ts',
  'tests/acceptance/19/status/budgets.test.ts', 'tests/acceptance/20/budgets.test.ts',
  'tests/acceptance/200/budgets.test.ts', 'tests/acceptance/2034/ac7-budget.test.ts', 'tests/acceptance/21/replay.test.ts',
  'tests/acceptance/21/sessions.live.test.ts', 'tests/acceptance/23/match/budgets.test.ts',
  'tests/acceptance/236/budgets.test.ts', 'tests/acceptance/237/budgets.test.ts',
  'tests/acceptance/238/budgets.test.ts', 'tests/acceptance/24/budgets.test.ts', 'tests/acceptance/24/redraft-1463/timing.test.ts',
  'tests/acceptance/25/live-redraft/ac2.live.test.ts', 'tests/acceptance/25/live/budgets.test.ts',
  'tests/acceptance/25/live/routes.live.test.ts', 'tests/acceptance/25/routes/twenty-minutes.test.ts',
  'tests/acceptance/25/routes/wake.test.ts', 'tests/acceptance/26/budgets.test.ts',
  'tests/acceptance/262/budgets.test.ts', 'tests/acceptance/27/budgets.test.ts',
  'tests/acceptance/28/budgets.test.ts', 'tests/acceptance/29/budgets.test.ts',
  'tests/acceptance/30/budgets.test.ts', 'tests/acceptance/303/budgets.test.ts',
  'tests/acceptance/304/budgets.test.ts', 'tests/acceptance/305/budgets.test.ts',
  'tests/acceptance/306/budgets.test.ts', 'tests/acceptance/31/budget-snapshot.test.ts',
  'tests/acceptance/31/budgets.test.ts', 'tests/acceptance/311/redraft-ac12/budgets.test.ts',
  'tests/acceptance/315/budgets-overhead-redraft.test.ts', 'tests/acceptance/315/budgets.test.ts',
  'tests/acceptance/319/budgets.test.ts', 'tests/acceptance/325/timing.test.ts',
  'tests/acceptance/331/budgets.test.ts', 'tests/acceptance/34/budgets.test.ts',
  'tests/acceptance/37/budgets.test.ts', 'tests/acceptance/37/redraft-ac16/budgets.test.ts',
  'tests/acceptance/340/flow/budgets.test.ts', 'tests/acceptance/348/budgets.test.ts',
  'tests/acceptance/356/budgets.test.ts', 'tests/acceptance/356/click.test.ts',
  'tests/acceptance/358/spike.live.test.mjs', 'tests/acceptance/365/budgets.test.ts', 'tests/acceptance/66/budgets.test.ts',
  'tests/acceptance/377/budgets.test.ts', 'tests/acceptance/379/reasons.test.ts',
  'tests/acceptance/380/budgets.test.ts', 'tests/acceptance/383/city.test.ts', 'tests/acceptance/385/spike.test.ts',
  'tests/acceptance/386/budgets.test.ts', 'tests/acceptance/387/budgets.test.ts',
  'tests/acceptance/39/budgets.test.ts', 'tests/acceptance/397/candles.test.ts',
  'tests/acceptance/399/budgets.test.ts', 'tests/acceptance/1417-redraft-ac3/estimate.test.ts', 'tests/acceptance/40/budgets.test.ts',
  'tests/acceptance/401/budgets.test.ts', 'tests/acceptance/402/budgets.test.ts',
  'tests/acceptance/412/budgets.test.ts', 'tests/acceptance/417/budgets.test.ts',
  'tests/acceptance/42/budgets.test.ts', 'tests/acceptance/489/budgets.test.ts',
  'tests/acceptance/55/budgets.test.ts', 'tests/acceptance/65/budgets.test.ts',
  'tests/acceptance/246/lanes.test.mjs', 'tests/acceptance/568/', 'tests/acceptance/583/perf-added-tests.test.mjs',
  'tests/acceptance/724/', 'tests/preflight.test.mjs',
  'tests/acceptance/572/budgets.test.ts', 'tests/acceptance/62/budgets.test.ts',
  'tests/acceptance/63/budgets.test.ts', 'tests/acceptance/667/redraft-1463/raised.test.ts',
  'tests/acceptance/667/redraft-2047/criteria.test.ts', 'tests/acceptance/667/redraft-2047/plants.test.ts', 'tests/acceptance/669/fast.test.ts', 'tests/acceptance/1156/fast.test.ts',
  'tests/acceptance/68/budgets.test.ts', 'tests/acceptance/69/budgets.test.ts',
  'tests/acceptance/761/budgets.test.ts', 'tests/acceptance/823/run.test.ts', 'tests/acceptance/823/wait.test.ts',
  'tests/acceptance/824/budgets.long.test.ts', 'tests/acceptance/824/redraft-ac1/budgets.long.test.ts',
  'tests/acceptance/83/budgets.test.ts', 'tests/acceptance/85/budgets.test.ts', 'tests/acceptance/854/idle.test.ts', 'tests/acceptance/1487/wakeups.test.ts',
  'tests/acceptance/854/patch.test.ts', 'tests/acceptance/854/replica.test.ts',
  'tests/acceptance/854/scene-read.test.ts', 'tests/acceptance/855/costs.test.ts',
  'tests/acceptance/855/keying.test.ts', 'tests/acceptance/857/background.test.ts',
  'tests/acceptance/857/speedup.test.ts', 'tests/acceptance/87/models/budgets.test.ts',
  'tests/acceptance/87/numbers/budget.test.ts', 'tests/acceptance/880/redraft/touch-id.test.ts',
  'tests/acceptance/880/touch-id.test.ts', 'tests/acceptance/881/latency.test.ts',
  'tests/acceptance/896/dirty.test.ts', 'tests/acceptance/896/settled.test.ts',
  'tests/acceptance/906/prompt.test.ts', 'tests/acceptance/906/stop.test.ts', 'tests/acceptance/96/budgets.test.ts',
  'tests/benchmark.test.mjs', 'tests/acceptance/1432/budgets.test.mjs',
  'tests/acceptance/1868/canvas-cells.test.mjs', 'tests/acceptance/1868/status-runs.test.mjs', 'tests/acceptance/2648/seen.test.ts'
];

alone.push('tests/acceptance/33/');
alone.push('tests/acceptance/1427/');
byHand.push('tests/acceptance/1427/ac8-budget.live.test.ts');
timed.push('tests/acceptance/1427/ac8-budget.live.test.ts');
alone.push('tests/acceptance/1861/');
alone.push('tests/acceptance/1550/');
alone.push('tests/acceptance/533/');
alone.push('tests/acceptance/194/', 'tests/acceptance/194-oracle/', 'tests/acceptance/194-redraft-ac11/');
timed.push('tests/acceptance/194-redraft-ac11/ac11-budgets.test.ts');
byHand.push('tests/acceptance/194/ac11-budgets.test.ts');
alone.push('tests/acceptance/832/');
alone.push('tests/acceptance/1434/');
byHand.push('tests/acceptance/1434/ac6-idle.live.test.ts', 'tests/acceptance/1434/ac7-budgets.live.test.ts', 'tests/acceptance/1434/ac8-snapshots.live.test.ts');
timed.push('tests/acceptance/1434/ac7-budgets.live.test.ts');
alone.push('tests/acceptance/1482/');
timed.push('tests/acceptance/1482/bench.test.ts');
alone.push('tests/acceptance/177/');
alone.push('tests/acceptance/177-redraft-ac3/');
byHand.push('tests/acceptance/177/ac3-sdr-outputs.test.ts');
byHand.push('tests/acceptance/177/ac4-layers.live.test.ts', 'tests/acceptance/177/ac5-envelope.live.test.ts', 'tests/acceptance/177/ac6-budgets.live.test.ts');
timed.push('tests/acceptance/177/ac6-budgets.live.test.ts');
alone.push('tests/acceptance/1436/');
byHand.push('tests/acceptance/1436/ac2-still.live.test.ts', 'tests/acceptance/1436/ac9-budgets.live.test.ts');
timed.push('tests/acceptance/1436/ac9-budgets.live.test.ts');
alone.push('tests/acceptance/1485/');
timed.push('tests/acceptance/1485/panel.test.ts');
alone.push('tests/acceptance/1486/');
timed.push('tests/acceptance/1486/grid.test.ts');
alone.push('tests/acceptance/2494/');
alone.push('tests/acceptance/1485-redraft-ac2/');
byHand.push('tests/acceptance/1485/cap.test.ts');
alone.push(...['word', 'recipe', 'document'].map((f) => `tests/acceptance/1493/${f}.test.ts`));
byHand.push('tests/acceptance/1493/census.test.ts');
byHand.push('tests/acceptance/33/next-pr.live.test.ts', 'tests/acceptance/33/spine.live.test.ts');
timed.push('tests/acceptance/33/budget.test.ts');
byHand.push('tests/acceptance/1816/judged-again.live.test.ts');

alone.push('tests/acceptance/1515/');
alone.push('tests/acceptance/1546/');
byHand.push('tests/acceptance/1546/ac4-needs-you.live.test.ts');
timed.push('tests/acceptance/1546/ac4-needs-you.live.test.ts');

alone.push('tests/acceptance/1348/');
alone.push('tests/acceptance/1455/');
alone.push('tests/acceptance/505/', 'tests/acceptance/505-oracle/');
alone.push('tests/acceptance/1653/', 'tests/acceptance/1653-redraft-ac2-flip/');
alone.push('tests/acceptance/536/');
alone.push('tests/acceptance/535/');
alone.push('tests/acceptance/1479/');
alone.push('tests/acceptance/531/', 'tests/acceptance/531-redraft-ac11/', 'tests/acceptance/531-redraft-ac12/');
alone.push('tests/acceptance/499/');
timed.push('tests/acceptance/499/video/players.test.ts', 'tests/acceptance/499/video/out-of-view.test.ts');
alone.push('tests/acceptance/500/', 'tests/acceptance/500-oracle/');
alone.push('tests/acceptance/532/');
alone.push('tests/acceptance/545/', 'tests/acceptance/545-redraft-ac3/', 'tests/acceptance/545-redraft-ac5/');
alone.push('tests/acceptance/1731/');
alone.push('tests/acceptance/534/');
timed.push('tests/acceptance/534/ac04-budgets.test.ts');
timed.push('tests/acceptance/3256/ac7-budget.test.mjs');
alone.push('tests/acceptance/1820/');
alone.push('tests/acceptance/1732/');
alone.push('tests/acceptance/190/');
alone.push('tests/acceptance/416/interfaces/');

alone.push('tests/acceptance/1477/');
timed.push('tests/acceptance/1477/record.test.ts', 'tests/acceptance/1477/built.test.ts', 'tests/acceptance/1477/redraft/record.test.ts');
byHand.push('tests/acceptance/1477/record.test.ts');
alone.push('tests/acceptance/2569/');
timed.push('tests/acceptance/2569/deadline.test.ts', 'tests/acceptance/2569/outlives.test.ts', 'tests/acceptance/2569/main.test.ts');
slow.push('tests/acceptance/2569/main.test.ts');
alone.push('tests/acceptance/1718/');
alone.push('tests/acceptance/1637/');
timed.push('tests/acceptance/1637/budgets.test.ts');
alone.push('tests/acceptance/1634/');
timed.push('tests/acceptance/1634/budgets.test.ts');
alone.push('tests/acceptance/1458/');
byHand.push('tests/acceptance/1458/redraft-ac13/shown.test.ts');
byHand.push('tests/acceptance/83/status.test.ts');
alone.push('tests/acceptance/501/', 'tests/acceptance/501-redraft-ac10/');
timed.push('tests/acceptance/501/budgets.test.ts');
alone.push('tests/acceptance/1818/');
alone.push('tests/acceptance/1720/', 'tests/acceptance/1718-redraft-1720/');
alone.push('tests/acceptance/1461/');
byHand.push('tests/acceptance/1461/shell.test.ts', 'tests/acceptance/1461/shown.test.ts');
timed.push('tests/acceptance/1461/budget.test.ts');
alone.push('tests/acceptance/1100/');
byHand.push('tests/acceptance/1100/shown.test.ts');
alone.push('tests/acceptance/2018/');
alone.push('tests/acceptance/2019/');
alone.push('tests/acceptance/1922/');
alone.push('tests/acceptance/1924/');
alone.push('tests/acceptance/1923/');
alone.push('tests/acceptance/1942/');
timed.push('tests/acceptance/1942/budgets.test.ts', 'tests/acceptance/1942/stall.test.ts');
alone.push('tests/acceptance/1945/');
alone.push('tests/acceptance/1946/');
alone.push('tests/acceptance/1943/');
alone.push('tests/acceptance/1983/');
alone.push('tests/acceptance/1462/', 'tests/acceptance/1462-redraft-ac2/');
byHand.push('tests/acceptance/1462/shown.test.ts');
alone.push('tests/acceptance/1901/');
alone.push('tests/acceptance/1925/');
alone.push('tests/acceptance/408/crossing.test.ts', 'tests/acceptance/408/overlap-covered.test.ts', 'tests/acceptance/408/cut.test.ts', 'tests/acceptance/408/module-label.test.ts');
alone.push('tests/acceptance/408-redraft-ac5/');
timed.push('tests/acceptance/408-redraft-ac5/machines.test.ts');
alone.push('tests/acceptance/1819/');
alone.push('tests/acceptance/502/', 'tests/acceptance/502-oracle/');
alone.push('tests/acceptance/503/', 'tests/acceptance/503-oracle/', 'tests/acceptance/503-redraft-ac1/');
byHand.push('tests/acceptance/503-redraft-ac4/');
alone.push('tests/acceptance/935/', 'tests/acceptance/935-oracle/');
byHand.push('tests/acceptance/408/machines.test.ts');
alone.push('tests/acceptance/405/broken-fixture.test.ts', 'tests/acceptance/405/floating-exception.test.ts', 'tests/acceptance/405/lid-sweep.test.ts');
alone.push('tests/acceptance/405-redraft-ac4/');
timed.push('tests/acceptance/405-redraft-ac4/budgets.test.ts');
byHand.push('tests/acceptance/405/budgets.test.ts');
alone.push('tests/acceptance/1936/');
alone.push('tests/acceptance/1935/');
alone.push('tests/acceptance/1938/machines.test.ts', 'tests/acceptance/1938-redraft-contrast/');
byHand.push('tests/acceptance/1938/faults.test.ts', 'tests/acceptance/1938-oracle/');
alone.push('tests/acceptance/1939/');
timed.push('tests/acceptance/1939/ac2-budget.test.ts');
alone.push('tests/acceptance/2513/');
timed.push('tests/acceptance/2513/ac2-budget.test.ts');
alone.push('tests/acceptance/2513-redraft-2047/');
timed.push('tests/acceptance/2513-redraft-2047/unchanged.test.ts');
alone.push('tests/acceptance/3017/');
timed.push('tests/acceptance/3017/budget.test.ts');
alone.push('tests/acceptance/456/');
alone.push('tests/acceptance/544/');
alone.push('tests/acceptance/202/');
timed.push('tests/acceptance/202/budgets.test.ts');
alone.push('tests/acceptance/1971/');
timed.push('tests/acceptance/1971/budget.test.ts');
alone.push('tests/acceptance/1972/');
alone.push('tests/acceptance/1973/');
alone.push('tests/acceptance/1974/');
alone.push('tests/acceptance/2717/');
alone.push('tests/acceptance/1957/');
alone.push('tests/acceptance/1961/');
alone.push('tests/acceptance/1399/');
alone.push('tests/acceptance/2015/');
alone.push('tests/acceptance/220/');
timed.push('tests/acceptance/220/budgets.test.ts');
alone.push('tests/acceptance/1976/');
alone.push('tests/acceptance/1405/', 'tests/acceptance/724-redraft-1405/');
timed.push('tests/acceptance/724-redraft-1405/');
alone.push('tests/acceptance/1575/', 'tests/acceptance/1575-redraft-ac1/');
timed.push('tests/acceptance/1575/budgets.test.ts', 'tests/acceptance/1575-redraft-ac1/budgets.test.ts');
alone.push('tests/acceptance/1964/');
alone.push('tests/acceptance/1965/', 'tests/acceptance/1965-oracle/');
alone.push('tests/acceptance/1963/');
alone.push('tests/acceptance/1723/');
alone.push('tests/acceptance/2205/');
alone.push('tests/acceptance/504/');
alone.push('tests/acceptance/504-redraft-ac1/', 'tests/acceptance/504-redraft-ac2/', 'tests/acceptance/504-redraft-ac8/');
alone.push('tests/acceptance/2026/', 'tests/acceptance/2026-redraft-ac3/');
timed.push('tests/acceptance/2026/load.test.ts', 'tests/acceptance/2026/outage.test.ts', 'tests/acceptance/2026-redraft-ac3/replay.test.ts');
byHand.push('tests/acceptance/2026/replay.test.ts');
alone.push('tests/acceptance/2028/');
alone.push('tests/acceptance/2021/');
alone.push('tests/acceptance/2029/');
alone.push('tests/acceptance/1101/');
alone.push('tests/acceptance/1056/');
alone.push('tests/acceptance/1897/', 'tests/acceptance/1899/', 'tests/acceptance/1903/');
alone.push('tests/acceptance/2189/', 'tests/acceptance/2189-redraft-ac1/', 'tests/acceptance/2189-redraft-ac3/', 'tests/acceptance/2691/');
alone.push('tests/acceptance/2009/', 'tests/acceptance/2009-redraft-ac2/', 'tests/acceptance/2010/', 'tests/acceptance/2010-oracle/');
alone.push('tests/acceptance/2011/', 'tests/acceptance/2012/', 'tests/acceptance/2012-oracle/');
timed.push('tests/acceptance/2011/ac2-step-budget.test.ts');
alone.push('tests/acceptance/547/');
timed.push('tests/acceptance/547/ac4-keyframes.test.ts');
alone.push('tests/acceptance/1967/');
alone.push('tests/acceptance/407/', 'tests/acceptance/407-oracle/');
alone.push('tests/acceptance/2014/', 'tests/acceptance/2014-oracle/');
alone.push('tests/acceptance/1956/');
alone.push('tests/acceptance/1959/');
alone.push('tests/acceptance/1960/');
alone.push('tests/acceptance/1962/');
alone.push('tests/acceptance/1802/');
alone.push('tests/acceptance/139-redraft-1802/');
byHand.push('tests/acceptance/139/prices.test.ts', 'tests/acceptance/350/ac9-redraft/ac9.test.ts');
alone.push('tests/acceptance/139-redraft-2062/');
alone.push('tests/acceptance/154/', 'tests/acceptance/154-oracle/');
timed.push('tests/acceptance/154/budgets.test.ts');
alone.push('tests/acceptance/154-redraft/', 'tests/acceptance/154-oracle-redraft/');
timed.push('tests/acceptance/154-redraft/budgets.test.ts');
byHand.push('tests/acceptance/154/stems.test.ts');
alone.push('tests/acceptance/155/', 'tests/acceptance/155-oracle/');
timed.push('tests/acceptance/155/budgets.test.ts');
slow.push('tests/acceptance/155/budgets.test.ts');
alone.push('tests/acceptance/155-redraft-ac9/');
byHand.push('tests/acceptance/155/pack.test.ts');
alone.push('tests/acceptance/1700/');
timed.push('tests/acceptance/1700/budgets.test.ts');
alone.push('tests/acceptance/1781/');
alone.push('tests/acceptance/409/', 'tests/acceptance/409-oracle/');
byHand.push('tests/acceptance/409/skill.test.ts');
alone.push('tests/acceptance/409-redraft-2697/', 'tests/acceptance/2697/');
alone.push('tests/acceptance/1163/');
alone.push('tests/acceptance/1164/');
alone.push('tests/acceptance/1862/');
alone.push('tests/acceptance/1401/');
alone.push('tests/acceptance/1729/');
alone.push('tests/acceptance/1958/');
timed.push('tests/acceptance/1958/budgets.test.ts');
alone.push('tests/acceptance/306-redraft-1958/');
alone.push('tests/acceptance/157/', 'tests/acceptance/157-oracle/');
timed.push('tests/acceptance/157/budgets.test.ts');
alone.push('tests/acceptance/518/');
timed.push('tests/acceptance/518/budgets.test.ts', 'tests/acceptance/518/slots.test.ts');
alone.push('tests/acceptance/518-redraft-ac10/');
timed.push('tests/acceptance/518-redraft-ac10/open.test.ts');
byHand.push('tests/acceptance/518/open.test.ts');
alone.push('tests/acceptance/162/', 'tests/acceptance/162-oracle/');
timed.push('tests/acceptance/162/budgets.test.ts');
alone.push('tests/acceptance/162-redraft-ac6/');
byHand.push('tests/acceptance/162/repeater.test.ts');
alone.push('tests/acceptance/1183/');
alone.push('tests/acceptance/537/', 'tests/acceptance/537-oracle/');
timed.push('tests/acceptance/537/ac4-budget.test.ts');
alone.push('tests/acceptance/539/');
alone.push('tests/acceptance/539-oracle-redraft/');
byHand.push('tests/acceptance/539-oracle/');
alone.push('tests/acceptance/538/', 'tests/acceptance/538-oracle/', 'tests/acceptance/538-redraft-ac8/');
timed.push('tests/acceptance/538/ac8-budgets.test.ts', 'tests/acceptance/538-redraft-ac8/ac8-budgets.test.ts');
byHand.push('tests/acceptance/538/ac8-budgets.test.ts');
alone.push('tests/acceptance/540/', 'tests/acceptance/540-oracle/');
alone.push('tests/acceptance/542/');
alone.push('tests/acceptance/903/');
alone.push('tests/acceptance/1920/');
alone.push('tests/acceptance/1863/');
timed.push('tests/acceptance/1863/speed.test.ts');
alone.push('tests/acceptance/2017/');
timed.push('tests/acceptance/2017/ac3-budgets.test.ts');
alone.push('tests/acceptance/2017-redraft-ac2/');
byHand.push('tests/acceptance/2017/ac2-light-holds.test.ts');
alone.push('tests/acceptance/173/');
timed.push('tests/acceptance/173/budgets.test.ts', 'tests/acceptance/173/envelope.test.ts');
slow.push('tests/acceptance/173/budgets.test.ts', 'tests/acceptance/173/envelope.test.ts');
alone.push('tests/acceptance/2070/', 'tests/acceptance/2070-gaps/');
alone.push('tests/acceptance/1725/');
alone.push('tests/acceptance/55-redraft-ac13/');
alone.push('tests/acceptance/1606/');
byHand.push('tests/acceptance/1606/device.test.ts');
alone.push('tests/acceptance/1606-redraft-ac5-ac9/');
alone.push('tests/acceptance/2324/');
alone.push('tests/acceptance/2085/');
alone.push('tests/acceptance/2362/');
alone.push('tests/acceptance/509/', 'tests/acceptance/509-oracle/');
timed.push('tests/acceptance/509/budgets.test.ts');
alone.push('tests/acceptance/2197/');
timed.push('tests/acceptance/2197/budget.test.ts');
alone.push('tests/acceptance/2144/');
alone.push('tests/acceptance/1332/');
alone.push('tests/acceptance/2120/');
alone.push('tests/acceptance/1347/');
alone.push('tests/acceptance/1347-redraft-1812/');
alone.push('tests/acceptance/1335/');
alone.push('tests/acceptance/1342/');
alone.push('tests/acceptance/1342-redraft-1812/');
alone.push('tests/acceptance/1345/');
alone.push('tests/acceptance/1349/');
alone.push('tests/acceptance/525/');
alone.push('tests/acceptance/525-device/');
timed.push('tests/acceptance/525-device/device.test.ts');
slow.push('tests/acceptance/525-device/device.test.ts');
alone.push('tests/acceptance/204/', 'tests/acceptance/204-oracle/');
timed.push('tests/acceptance/204/budgets.test.ts');
alone.push('tests/acceptance/204-redraft-ac7/');
alone.push('tests/acceptance/204-gaps/');
byHand.push('tests/acceptance/204/export.test.ts');
alone.push('tests/acceptance/450/');
alone.push('tests/acceptance/451/');
alone.push('tests/acceptance/239/', 'tests/look-type.test.ts');
timed.push('tests/acceptance/239/seek-play.test.ts', 'tests/acceptance/239/budget.test.ts', 'tests/acceptance/239/off-reference.test.ts');
slow.push('tests/acceptance/239/exports.test.ts', 'tests/acceptance/239/checks.test.ts');
alone.push('tests/acceptance/507/', 'tests/acceptance/507-oracle/');
alone.push('tests/acceptance/169/');
timed.push('tests/acceptance/169/budgets.test.ts');
alone.push('tests/acceptance/226/');
timed.push('tests/acceptance/226/ac7-budgets.test.ts');
alone.push('tests/acceptance/2450/');
alone.push('tests/acceptance/226-oracle-redraft/');
byHand.push('tests/acceptance/226-oracle/');
alone.push('tests/acceptance/462/', 'tests/look-regions-paths.test.ts');
alone.push('tests/acceptance/466/', 'tests/acceptance/466-redraft-ac3/', 'tests/acceptance/466-redraft-ac6/', 'tests/acceptance/466-redraft-ac7/');
byHand.push(...['ac3-boil', 'ac6-captions', 'ac7-blur'].map((f) => `tests/acceptance/466/${f}.test.ts`));
alone.push('tests/acceptance/222/', 'tests/acceptance/222-oracle/', 'tests/acceptance/222-redraft-ac7/');
timed.push('tests/acceptance/222-redraft-ac7/budgets.test.ts');
byHand.push('tests/acceptance/222/budgets.test.ts');
alone.push('tests/acceptance/223/', 'tests/acceptance/223-oracle/');
timed.push('tests/acceptance/223/ac7-budgets.test.ts');
alone.push('tests/acceptance/225/', 'tests/acceptance/225-oracle/');
timed.push('tests/acceptance/225/ac6-budgets.test.ts');
alone.push('tests/acceptance/225-oracle-redraft-ac7/');
byHand.push('tests/acceptance/225-oracle/ac7-flow-field.test.ts');
alone.push('tests/acceptance/225-redraft-ac5/');
byHand.push('tests/acceptance/225/ac5-lorenz-two-machines.test.ts');
alone.push('tests/acceptance/172/', 'tests/acceptance/172-oracle/');
alone.push('tests/acceptance/549/', 'tests/acceptance/549-oracle/');
alone.push('tests/acceptance/549-redraft-ac2/');
alone.push('tests/acceptance/550/', 'tests/acceptance/550-oracle/');
alone.push('tests/acceptance/551/', 'tests/acceptance/551-oracle/');
alone.push('tests/acceptance/280/');
timed.push('tests/acceptance/280/ac8-budgets.test.ts');
alone.push('tests/acceptance/280-redraft-ac4/');
byHand.push('tests/acceptance/280/ac4-depth.test.ts');
alone.push('tests/acceptance/277/');
alone.push('tests/acceptance/552/');
alone.push('tests/acceptance/290/');
alone.push('tests/acceptance/553/');
alone.push('tests/acceptance/278/');
byHand.push('tests/acceptance/549/ac2-join-only.test.ts');
alone.push('tests/acceptance/297/', 'tests/acceptance/297-oracle/');
timed.push('tests/acceptance/172/budgets.test.ts', 'tests/acceptance/172/images.test.ts');
alone.push('tests/acceptance/172-redraft-ac2/');
byHand.push('tests/acceptance/172/refusals.test.ts');
alone.push('tests/acceptance/2892/', 'tests/acceptance/172-redraft-ac4/');
timed.push('tests/acceptance/2892/first-frame.test.ts');
alone.push('tests/acceptance/172-redraft-2892/', 'tests/acceptance/1490-redraft-2892/', 'tests/acceptance/210-redraft-2892/');
alone.push('tests/acceptance/192/packs-redraft-2892/');
byHand.push('tests/acceptance/172/hashes.test.ts', 'tests/acceptance/1490/picks.test.ts');
byHand.push('tests/acceptance/192/packs/outside.test.ts', 'tests/acceptance/210/ac6-web-export.test.ts');
alone.push('tests/acceptance/1041/');
alone.push('tests/acceptance/1045/');
alone.push('tests/acceptance/2856/');
alone.push('tests/acceptance/1490/');
alone.push('tests/acceptance/1969/');
alone.push('tests/acceptance/142/', 'tests/acceptance/142-redraft-ac9/', 'tests/acceptance/142-redraft-ac10/');
byHand.push(...['ac9-timing', 'ac10-pack'].map((f) => `tests/acceptance/142/${f}.test.ts`));
timed.push('tests/acceptance/142/ac6-budgets.test.ts');
alone.push('tests/acceptance/548/');
timed.push('tests/acceptance/548/ac3-budgets.test.ts');
alone.push('tests/acceptance/224/', 'tests/acceptance/224-oracle/');
timed.push('tests/acceptance/224/ac02-rebuild-budget.test.ts');
alone.push('tests/acceptance/1940/');
alone.push('tests/acceptance/1968/', 'tests/acceptance/1968-oracle/');
timed.push('tests/acceptance/1968/ac2-budgets.test.ts');
alone.push('tests/acceptance/2497/');
alone.push('tests/acceptance/2073/');
alone.push('tests/acceptance/26-redraft-2073/', 'tests/acceptance/19-redraft-2073/', 'tests/acceptance/823-redraft-2073/', 'tests/acceptance/27-redraft-2073/', 'tests/acceptance/1942-redraft-2073/');
timed.push('tests/acceptance/823-redraft-2073/run.test.ts');
slow.push('tests/acceptance/326-redraft-2073/click.test.ts', 'tests/acceptance/27-redraft-2073/waits.test.ts');
byHand.push('tests/acceptance/26/contradiction.test.ts', 'tests/acceptance/822/hub.test.ts', 'tests/acceptance/19/setup/watchonly.test.ts', 'tests/acceptance/326/setup/click.test.ts', 'tests/acceptance/326/setup/first-command.test.ts',
  'tests/acceptance/823/run.test.ts', 'tests/acceptance/823/stop.test.ts', 'tests/acceptance/27/waits.test.ts', 'tests/acceptance/1942/survives.test.ts');
alone.push('tests/acceptance/16-redraft-1865/');
exclusive.push('tests/acceptance/16-redraft-1865/');
byHand.push('tests/acceptance/16/service.test.ts', 'tests/acceptance/16/roles.test.ts', 'tests/acceptance/1334/contract.test.mjs', 'tests/acceptance/1334/crash.test.mjs',
  'tests/acceptance/1334/misjudge.test.mjs');
alone.push('tests/acceptance/468/', 'tests/acceptance/468-redraft-ac3/');
byHand.push('tests/acceptance/468/ac3-leader.test.ts');
timed.push('tests/acceptance/468/ac5-budgets.test.ts');
alone.push('tests/acceptance/506/', 'tests/acceptance/506-redraft-ac5/');
byHand.push('tests/acceptance/506/ac5-lamp-card.test.ts');
alone.push('tests/acceptance/298/');
alone.push('tests/acceptance/508/');
timed.push('tests/acceptance/508/ac4-budgets.test.ts');
byHand.push('tests/acceptance/508/ac1-skill.live.test.ts');
alone.push('tests/acceptance/213/', 'tests/acceptance/213-oracle/');
timed.push('tests/acceptance/213/ac8-budgets.test.ts');
alone.push('tests/acceptance/213-redraft-ac3/');
byHand.push('tests/acceptance/213/ac3-trap-fuel.test.ts');
alone.push('tests/acceptance/463/');
timed.push('tests/acceptance/463/ac2-budgets.test.ts');
alone.push('tests/acceptance/233/', 'tests/acceptance/233-oracle/');
timed.push('tests/acceptance/233/ac11-budgets.test.ts');
alone.push('tests/acceptance/184/');
timed.push('tests/acceptance/184/budgets.test.ts');
alone.push('tests/acceptance/184-redraft-ac7-2/');
byHand.push('tests/acceptance/184/ac07-bots-refused.test.ts', 'tests/acceptance/184-redraft-ac7/ac7-bots-refused.test.ts');
alone.push('tests/acceptance/555/');
alone.push('tests/acceptance/1048/');
alone.push('tests/acceptance/1040/');
alone.push('tests/acceptance/556/');
timed.push('tests/acceptance/556/ac05-budgets.test.ts');
alone.push('tests/acceptance/556-redraft-ac5/');
timed.push('tests/acceptance/556-redraft-ac5/ac5-budgets.test.ts');
alone.push('tests/acceptance/1808/');
byHand.push('tests/acceptance/1808/shown.test.ts');
alone.push('tests/acceptance/458/pairs/', 'tests/acceptance/458/relations/', 'tests/acceptance/458/views/');
alone.push('tests/acceptance/192/dungeon/');
alone.push('tests/acceptance/860/');

alone.push('tests/acceptance/2516/');
timed.push('tests/acceptance/2516/timing.test.ts');
alone.push('tests/acceptance/457/');
timed.push('tests/acceptance/457/ac9-budgets.test.ts');

alone.push('tests/acceptance/1636/');
timed.push('tests/acceptance/1636/ac8-budget.test.ts');
alone.push('tests/acceptance/210/');
timed.push('tests/acceptance/210/ac8-budgets.test.ts');
alone.push('tests/acceptance/2031/');
timed.push('tests/acceptance/2031/ac8-budget.test.ts');
alone.push('tests/acceptance/1561/');
alone.push('tests/acceptance/2032/', 'tests/acceptance/2032-redraft-ac8/');
timed.push('tests/acceptance/2032/ac8-budget.test.ts', 'tests/acceptance/2032-redraft-ac8/ac8-budget.test.ts');
timed.push('tests/acceptance/2844/ac1-budget.test.ts');
alone.push('tests/acceptance/2844-redraft-moving/');
alone.push('tests/acceptance/2053/');
timed.push('tests/acceptance/2053/ac7-budget.test.ts');
alone.push('tests/acceptance/182/', 'tests/acceptance/182-oracle/controllers-py-rapier.test.ts', 'tests/acceptance/182-oracle-redraft-climb/');
timed.push('tests/acceptance/182/ac11-budgets.test.ts');
byHand.push('tests/acceptance/182-oracle/character-controller-rapier.test.ts');
alone.push('tests/acceptance/2240/');
alone.push('tests/acceptance/2309/', 'tests/acceptance/2243/');
alone.push('tests/acceptance/2241/', 'tests/acceptance/2009-redraft-2241/');
alone.push('tests/acceptance/2239/', 'tests/acceptance/2239-redraft-ac4/');
alone.push('tests/acceptance/2248/');
alone.push('tests/acceptance/2098/', 'tests/acceptance/2098-redraft-ac2/');
alone.push('tests/acceptance/2307/');
alone.push('tests/acceptance/2310/');
alone.push('tests/acceptance/2308/', 'tests/acceptance/191-redraft-2308/');
alone.push('tests/acceptance/2371/');
alone.push('tests/acceptance/1931/', 'tests/acceptance/191-redraft-1931/');
timed.push('tests/acceptance/3258/ac6-budget.test.ts');

alone.push('tests/acceptance/2742/');

alone.push('tests/acceptance/192/voxel/');
timed.push('tests/acceptance/192/voxel/ac10-budgets.test.ts');
alone.push('tests/acceptance/192/packs/', 'tests/acceptance/192/packs-redraft-ac12/');
alone.push('tests/acceptance/416/layouts/');
timed.push('tests/acceptance/416/layouts/budgets.test.ts');

byHand.push('tests/acceptance/1330/start.live.test.ts');
byHand.push('tests/acceptance/1666/');

timed.push(...['1015', '1017', '1425', '148', '149', '1515', '160', '167', '222', '308', '405', '45', '67']
  .map((issue) => `tests/acceptance/${issue}/budgets.test.ts`),
  'tests/acceptance/1555/budget-load.test.mjs', 'tests/acceptance/408/machines.test.ts',
  'tests/acceptance/501/exports.test.ts', 'tests/acceptance/824/sessions/budgets.long.test.ts',
  ...['access', 'queries', 'taste'].map((name) => `tests/acceptance/990/${name}.test.ts`));
alone.push(...['1017', '1097', '111', '304', '308', '31', '40', '45', '572', '63', '69']
  .map((issue) => `tests/acceptance/${issue}/budgets.test.ts`));

export const redrafted = Object.fromEntries([
  ...[['103', 'budgets.test.ts'], ['365', 'budgets.test.ts'], ['262', 'budgets.test.ts'], ['761', 'budgets.test.ts'], ['1098', 'budgets.test.ts'],
    ['148', 'budgets.test.ts'], ['417', 'budgets.test.ts'], ['1425', 'budgets.test.ts'], ['149', 'budgets.test.ts'], ['568', 'judge.test.mjs'],
    ['124', 'ac5-budgets.live.test.ts'], ['1427', 'ac8-budget.live.test.ts'], ['311', 'redraft-ac12/budgets.test.ts'],
    ['1018', 'redraft-ac6/budgets.test.ts'], ['1018', 'redraft-ac6/helpers.ts'],
    ...['166', '268', '465', '968'].flatMap((n) => [[n, 'budgets.test.ts'], [n, 'helpers.ts']])]
    .map(([issue, file]) => [`tests/acceptance/${issue}/${file}`, `tests/acceptance/${issue}-redraft-1830/`]),
  ['tests/acceptance/2032/ac8-budget.test.ts', 'tests/acceptance/2032-redraft-ac8/'],
]);
byHand.push(...Object.keys(redrafted).filter((path) => /\.test\.m?[jt]s$/.test(path) && !byHand.includes(path)));
alone.push(...['103', '365', '262', '761', '1098', '417', '149', '124', '1427', '311', '1018', '166', '268', '465', '968'].map((n) => `tests/acceptance/${n}-redraft-1830/`), 'tests/acceptance/1830/ac2-timing.test.ts');
timed.push(...['103', '365', '262', '761', '1098', '148', '417', '1425', '149', '311', '1018', '166', '268', '465', '968'].map((n) => `tests/acceptance/${n}-redraft-1830/budgets.test.ts`),
  'tests/acceptance/124-redraft-1830/ac5-budgets.live.test.ts', 'tests/acceptance/1427-redraft-1830/ac8-budget.live.test.ts', 'tests/acceptance/1830/ac2-timing.test.ts');
byHand.push('tests/acceptance/124-redraft-1830/ac5-budgets.live.test.ts', 'tests/acceptance/1427-redraft-1830/ac8-budget.live.test.ts');
timed.push('tests/acceptance/568-redraft-1830/judge.test.mjs', 'tests/acceptance/903/ac6-export.test.ts', 'tests/acceptance/508/ac6-effects.test.ts');
timed.push('tests/acceptance/1838/lane568.test.mjs');

alone.push('tests/acceptance/1381/');
timed.push('tests/acceptance/1381/ac6-budget.test.ts');
alone.push('tests/acceptance/971/');
timed.push('tests/acceptance/971/budgets.test.ts');

alone.push('tests/acceptance/1992/', 'tests/acceptance/1992-redraft-ac5/');
timed.push('tests/acceptance/1992/cost.test.ts');

alone.push('tests/acceptance/1831/');

alone.push('tests/acceptance/2652/');

alone.push('tests/acceptance/1928/');

alone.push(...['cycles', 'planted-answers', 'planted-results', 'planted-jobs', 'planted-names', 'retries', 'jobs', 'replay'].map((f) => `tests/acceptance/2650/${f}.test.ts`));
byHand.push('tests/acceptance/2650/budgets.long.test.ts');
timed.push('tests/acceptance/2650/budgets.long.test.ts');

alone.push(...['heap', 'equal', 'data-row', 'as-given'].map((f) => `tests/acceptance/2700/${f}.test.mjs`));
byHand.push('tests/acceptance/2700/budgets.long.test.mjs');
timed.push('tests/acceptance/2700/budgets.long.test.mjs');
alone.push('tests/acceptance/2700/reached.test.mjs');

alone.push('tests/acceptance/1498/');

alone.push('tests/acceptance/1812/');
alone.push('tests/acceptance/67-redraft-1812/');
alone.push('tests/acceptance/66-redraft-1812/');

alone.push('tests/acceptance/1495/app-download.test.ts');
alone.push('tests/acceptance/1592/');
byHand.push('tests/acceptance/1592/shown.test.ts');

byHand.push('tests/acceptance/1592-redraft-ac4/');

alone.push('tests/acceptance/1431/');
timed.push('tests/acceptance/1431/ac5-cost.test.ts');

alone.push('tests/acceptance/1801/');
alone.push('tests/acceptance/2403/');
byHand.push('tests/acceptance/2403/shown.test.ts');

alone.push('tests/acceptance/1411/');

alone.push('tests/acceptance/1512/');
alone.push('tests/acceptance/2748/');
timed.push('tests/acceptance/2748/budgets.test.ts');

alone.push('tests/acceptance/1509/');

alone.push('tests/acceptance/1929/');

alone.push('tests/acceptance/2760/');
timed.push('tests/acceptance/2760/budgets.test.ts');
alone.push('tests/acceptance/2760-redraft-ac8/');
timed.push('tests/acceptance/2760-redraft-ac8/budget-timing.test.ts');
byHand.push('tests/acceptance/2760/budgets.test.ts');
timed.push('tests/acceptance/2386/ac6-budget.test.ts');
alone.push('tests/acceptance/2386-redraft-ac6-hashes/');
timed.push('tests/acceptance/2039/ac4-budget.test.ts');
alone.push('tests/acceptance/2039-oracle/');
byHand.push('tests/acceptance/1456/legacy.test.ts', 'tests/acceptance/1456/agree.test.ts');
alone.push('tests/acceptance/1456-redraft-ac2-ac4/');
alone.push('tests/acceptance/2897/', 'tests/acceptance/2897-redraft-ac6/');
byHand.push('tests/acceptance/2897/ac6-full-schema.test.ts');
alone.push('tests/acceptance/1826/');
alone.push('tests/acceptance/732/');
timed.push('tests/acceptance/732/ac10-budgets.test.ts');

alone.push('tests/acceptance/1484/');
timed.push('tests/acceptance/1484/warm.test.ts');

alone.push('tests/acceptance/1415/');
alone.push('tests/acceptance/806-redraft-ac3/');
byHand.push('tests/acceptance/806/unbound.test.ts');
alone.push('tests/acceptance/1430/');
timed.push('tests/acceptance/1430/ac4-budgets.test.ts');
alone.push('tests/acceptance/1430-redraft-ac2/');
byHand.push('tests/acceptance/1430/ac2-property.test.ts');

alone.push('tests/acceptance/2402/');

alone.push('tests/acceptance/2456/');
alone.push('tests/write-reveal-frames.test.ts');

byHand.push('tests/acceptance/2204/rules-unreadable.test.ts');

byHand.push('tests/acceptance/1097/computed.test.ts', 'tests/acceptance/1097/depth.test.ts');

byHand.push('tests/acceptance/323/review.test.ts');
alone.push('tests/acceptance/323-redraft-2171/');

alone.push('tests/acceptance/2776/seal.test.ts', 'tests/acceptance/2776/export.test.ts', 'tests/acceptance/2776/listing.test.ts');

alone.push('tests/acceptance/1215/');

alone.push('tests/acceptance/2457/');

alone.push('tests/acceptance/2645/');
timed.push('tests/acceptance/2645/big.test.ts');

alone.push('tests/acceptance/2500/');

alone.push('tests/acceptance/1489/');
timed.push('tests/acceptance/1489/ui-thread.test.ts');

alone.push('tests/acceptance/2777/');
timed.push('tests/acceptance/2777/preflight.test.ts', 'tests/acceptance/194/ac11-budgets.test.ts', 'tests/acceptance/2402/budget.test.ts', 'tests/acceptance/277/ac4-budgets.test.ts', 'tests/acceptance/278/ac5-budgets.test.ts', 'tests/acceptance/518/handoff.test.ts', 'tests/acceptance/518/planes.test.ts');
alone.push('tests/acceptance/211/');
timed.push('tests/acceptance/211/ac8-budgets.test.ts');

alone.push('tests/acceptance/2896/');

alone.push('tests/acceptance/981/');
timed.push('tests/acceptance/981/ac8-budget.test.ts');
timed.push('tests/acceptance/1255/ac5-budget.test.ts');
timed.push('tests/acceptance/1181/ac09-budget.test.ts');
timed.push('tests/acceptance/3604/ac15-budget.test.ts');

alone.push('tests/acceptance/2898/');
alone.push('tests/acceptance/189/saves/', 'tests/acceptance/189-oracle/', 'tests/acceptance/189/carry/');
timed.push('tests/acceptance/189/saves/ac11-budgets.test.ts');
alone.push('tests/acceptance/189/lab-redraft/');
timed.push('tests/acceptance/189/lab-redraft/ac11-rederive-budget.test.ts');
byHand.push('tests/acceptance/189/lab/');
alone.push('tests/acceptance/851/');
byHand.push('tests/acceptance/851/ac08-shown.test.ts');
alone.push('tests/acceptance/276/record/', 'tests/acceptance/276/match/', 'tests/acceptance/276/web/');

alone.push('tests/acceptance/2227/');
slow.push('tests/acceptance/2227/ac2-native-build.test.ts');

alone.push('tests/acceptance/2109/');

alone.push('tests/acceptance/1518/');
timed.push('tests/acceptance/1518/budget.test.ts');
alone.push('tests/acceptance/1518-redraft-ac1/');
byHand.push('tests/acceptance/1518/heard.test.ts');

alone.push('tests/acceptance/953/', 'tests/acceptance/953-oracle/');

alone.push('tests/acceptance/2738/');
slow.push('tests/acceptance/2738/ac1-linux-build.test.ts');

timed.push('tests/acceptance/161/ac4-measured.test.ts', 'tests/acceptance/161/ac6-timed.test.ts');

alone.push('tests/acceptance/265/');
timed.push('tests/acceptance/265/ac6-budgets.test.ts');
alone.push('tests/acceptance/1250/');
timed.push('tests/acceptance/1250/ac7-budgets.test.ts');

alone.push('tests/acceptance/1576/');

alone.push('tests/acceptance/3016/');

alone.push('tests/acceptance/2661/');
byHand.push('tests/acceptance/2661/ac4-tick.live.test.mjs', 'tests/acceptance/2661/ac7-budgets.test.mjs');
timed.push('tests/acceptance/2661/ac4-tick.live.test.mjs', 'tests/acceptance/2661/ac7-budgets.test.mjs');

alone.push('tests/acceptance/980/');
timed.push('tests/acceptance/980/ac09-budget.test.ts');
alone.push('tests/acceptance/980-redraft-ac9/');
timed.push('tests/acceptance/980-redraft-ac9/ac9-budget.test.ts');
byHand.push('tests/acceptance/980/ac09-budget.test.ts');

slow.push('tests/acceptance/689-redraft-2047/ac2-checks.test.mjs', 'tests/acceptance/689-redraft-2047/ac4-app-in-unit-lane.test.mjs');

alone.push('tests/acceptance/2173-redraft-2047/');

slow.push('tests/acceptance/3100/ac1-build.test.mjs', 'tests/acceptance/3100/ac2-test.test.mjs');

alone.push('tests/acceptance/2086-redraft-2047/');
slow.push('tests/acceptance/2086-redraft-2047/ac1-workspace-clippy.test.ts', 'tests/acceptance/2086-redraft-2047/ac2-1732-unchanged.test.ts');

alone.push('tests/acceptance/1500/', 'tests/acceptance/1500-oracle/');
timed.push('tests/acceptance/1500/ac08-join-time.test.ts');

slow.push('tests/acceptance/2740/as-on-main.test.ts');
timed.push('tests/acceptance/2740/as-on-main.test.ts');

alone.push('tests/acceptance/2215/');
alone.push('tests/acceptance/2215-redraft-ac5/');

alone.push('tests/acceptance/269-redraft-ac6/');
timed.push('tests/acceptance/269/ac6-budgets.test.ts', 'tests/acceptance/269-redraft-ac6/ac6-budgets.test.ts');
byHand.push('tests/acceptance/269/ac6-budgets.test.ts');

alone.push('tests/acceptance/3236/');
alone.push('tests/acceptance/3236-redraft-ac8/', 'tests/live-window-hidden.test.ts');
byHand.push('tests/acceptance/3236/ac8-appkit.test.ts');
alone.push('tests/web-reading-walk.test.ts');
byHand.push('tests/acceptance/2848/', 'tests/jobserver-blind.test.mjs');

timed.push('tests/acceptance/3234/budgets.test.ts');
byHand.push('tests/acceptance/3234/shown.test.ts');
byHand.push('tests/acceptance/3234/answer.test.ts');
alone.push('tests/acceptance/3234-redraft-ac3/');
byHand.push('tests/acceptance/3234/card.test.ts');
alone.push('tests/acceptance/3234-redraft-ac6/');
alone.push('tests/acceptance/1881-redraft-2047/');
timed.push('tests/acceptance/1881-redraft-2047/suites85.test.ts');
slow.push('tests/acceptance/1881-redraft-2047/suites85.test.ts');

byHand.push('tests/acceptance/112/eval.test.ts', 'tests/acceptance/112/ci.test.ts', 'tests/acceptance/2077/removal.test.ts', 'tests/acceptance/2495/report.test.ts');

Object.assign(redrafted, Object.fromEntries([
  ...['patch.test.ts', 'scene-read.test.ts', 'idle.test.ts', 'replica.test.ts', 'release.test.ts', 'replica-redraft.test.ts', 'helpers.ts']
    .map((file) => [`tests/acceptance/854/${file}`, 'tests/acceptance/854/redraft-3300/']),
  ...['settled.test.ts', 'dirty.test.ts', 'helpers.ts'].map((file) => [`tests/acceptance/896/${file}`, 'tests/acceptance/896/redraft-3300/']),
]));
byHand.push(...Object.keys(redrafted).filter((path) => /^tests\/acceptance\/(854|896)\/[^/]+\.test\.ts$/.test(path) && !byHand.includes(path)));
timed.push(...['idle', 'patch', 'replica', 'scene-read'].map((name) => `tests/acceptance/854/redraft-3300/${name}.test.ts`),
  ...['dirty', 'settled'].map((name) => `tests/acceptance/896/redraft-3300/${name}.test.ts`));
byHand.push('tests/acceptance/3300/fit-mac.long.test.ts');
timed.push('tests/acceptance/3300/fit-mac.long.test.ts');
Object.assign(redrafted, {
  'tests/acceptance/1492/idle-energy.test.ts': 'tests/acceptance/1492/redraft-3300/',
  'tests/acceptance/1492/helpers.ts': 'tests/acceptance/1492/redraft-3300/',
  'tests/acceptance/1551/lane.test.ts': 'tests/acceptance/1551/redraft-3300/',
});
byHand.push('tests/acceptance/1492/idle-energy.test.ts', 'tests/acceptance/1551/lane.test.ts');
redrafted['tests/acceptance/854/redraft-3300/idle.test.ts'] = 'tests/acceptance/854/redraft-3370/';
byHand.push('tests/acceptance/854/redraft-3300/idle.test.ts');

timed.push('tests/acceptance/1815/budget.test.ts');
byHand.push('tests/acceptance/1815/shown.test.ts');

byHand.push('tests/acceptance/1866/budgets.long.test.ts');
timed.push('tests/acceptance/1866/budgets.long.test.ts');

alone.push('tests/acceptance/96-redraft-1412/');
byHand.push('tests/acceptance/96/commit.test.ts', 'tests/acceptance/96/proof.test.ts', 'tests/acceptance/96/undo-ac9-first-draft.test.ts');

Object.assign(redrafted, { 'tests/acceptance/3295/late-close.test.mjs': 'tests/acceptance/3295-redraft-fae86cca/' });
byHand.push('tests/acceptance/3295/late-close.test.mjs');

Object.assign(redrafted, { 'tests/acceptance/3066/same-failures.test.mjs': 'tests/acceptance/3066-redraft-3699/' });
byHand.push('tests/acceptance/3066/same-failures.test.mjs');

timed.push('tests/acceptance/3257/ac7-budget.test.ts');

timed.push('tests/acceptance/1857/cap.test.ts', 'tests/acceptance/1857/budgets.test.ts');

timed.push('tests/acceptance/1867/codex-watch.test.ts', 'tests/acceptance/1867/claude-json.test.ts');

timed.push('tests/acceptance/2750/budgets.test.ts');

Object.assign(redrafted, { 'tests/acceptance/3461/once.test.ts': 'tests/acceptance/3461-redraft-once/' });
byHand.push('tests/acceptance/3461/once.test.ts');

timed.push('tests/acceptance/3467/players.test.ts');

Object.assign(redrafted, Object.fromEntries([['1113', 'cli'], ['3238', 'serial'], ['3238', 'no-grant'], ['3240', 'line'], ['3334', 'stall'], ['3334', 'far-stalled'], ['3567', 'grant'], ['2820', 'failures']]
  .map(([issue, file]) => [`tests/acceptance/${issue}/${file}.test.mjs`, `tests/acceptance/${issue}-redraft-3549/`])));
byHand.push(...Object.keys(redrafted).filter((path) => redrafted[path].endsWith('-redraft-3549/')));

Object.assign(redrafted, Object.fromEntries([['2924', 'test-grants'], ['2924', 'blocked'], ['2924', 'log'], ['3238', 'inherited'], ['3549', 'passes'], ['3549', 'timed'], ['3549', 'window']]
  .map(([issue, file]) => [`tests/acceptance/${issue}/${file}.test.mjs`, `tests/acceptance/${issue}-redraft-3694/`])));
byHand.push(...Object.keys(redrafted).filter((path) => redrafted[path].endsWith('-redraft-3694/')));

Object.assign(redrafted, { 'tests/acceptance/1113/measured.test.mjs': 'tests/acceptance/1113-redraft-3296/' });
byHand.push('tests/acceptance/1113/measured.test.mjs');

timed.push('tests/acceptance/3507/ac3-timing.test.mjs');

Object.assign(redrafted, { 'tests/acceptance/3507/ac2-classes.test.mjs': 'tests/acceptance/3507-redraft-ac2/' });
byHand.push('tests/acceptance/3507/ac2-classes.test.mjs');
alone.push('tests/acceptance/3507-redraft-ac2/');

timed.push('tests/acceptance/3617/ac2-onepass.test.ts');

for (const name of ['ac1-section', 'ac3-agent-routes', 'ac5-taste-call']) {
  redrafted[`tests/acceptance/1352/${name}.test.mjs`] = 'tests/acceptance/1352-redraft-3402/';
  byHand.push(`tests/acceptance/1352/${name}.test.mjs`);
}
redrafted['tests/acceptance/1352-redraft-3402/ac1-section.test.mjs'] = 'tests/acceptance/1352-redraft-3413/';
byHand.push('tests/acceptance/1352-redraft-3402/ac1-section.test.mjs');
redrafted['tests/acceptance/2790/purpose.test.ts'] = 'tests/acceptance/2790-redraft-3413/';
byHand.push('tests/acceptance/2790/purpose.test.ts');

byHand.push('tests/acceptance/2813-redraft-ac2/branch.test.mjs');

// #3525 moves the asset fetch from deep_kinds to deep_job and refuses deep_kinds' fetch, so the files below, which
// brought an asset in through deep_kinds, no longer hold their scene; #2898's table, reads and repeats files state
// deep_kinds' old hints. Each is kept as written, by hand only, and its blind redraft runs in its place, alone: each
// starts a hub with a sandboxed fill (scripts/lanes.mjs names the shared resource).
const redrafts3525 = {
  '1731-redraft-3525': ['1731/fetch', '1731/off', '1731/offline', '1731/unknown'],
  '1820-redraft-3525': ['1820/disk', '1820/fetch', '1820/license', '1820/offline', '1820/scope/license-file', '1820/scope/resume', '1820/scope/reuse', '1820/export-redraft/export'],
  '154-redraft-3525': ['154/budgets', '154/cache', '154/fetch', '154/licences', '154/onsets'],
  '154-redraft-3525b': ['154-redraft/budgets', '154-redraft/cache', '154-redraft/determinism', '154-redraft/loop', '154-redraft/offline', '154-redraft/onsets'],
  '154-oracle-redraft-3525': ['154-oracle/sample-accurate'],
  '154-oracle-redraft-redraft-3525': ['154-oracle-redraft/sample-accurate'],
  '155-oracle-redraft-3525': ['155-oracle/sample-accurate'],
  '2123-redraft-3525': ['2123/fetch-again'],
  '2898-redraft-3525': ['2898/table', '2898/reads', '2898/repeats'],
};
for (const [folder, originals] of Object.entries(redrafts3525)) {
  for (const file of originals) {
    redrafted[`tests/acceptance/${file}.test.ts`] = `tests/acceptance/${folder}/`;
    byHand.push(`tests/acceptance/${file}.test.ts`);
  }
  alone.push(`tests/acceptance/${folder}/`);
}
// The redrafted budget files time the six-stem render, as #154's and #154-redraft's do.
timed.push('tests/acceptance/154-redraft-3525/budgets.test.ts', 'tests/acceptance/154-redraft-3525b/budgets.test.ts');

Object.assign(redrafted, { 'tests/acceptance/2665/lowering.test.mjs': 'tests/acceptance/2665-redraft-3537/' });
byHand.push('tests/acceptance/2665/lowering.test.mjs');

Object.assign(redrafted, { 'tests/acceptance/1503/inline.test.ts': 'tests/acceptance/1503-redraft-defaults/', 'tests/acceptance/1676/spellings.test.ts': 'tests/acceptance/1676-redraft-defaults/', 'tests/acceptance/1662/ac1-tree.test.ts': 'tests/acceptance/1662-redraft-config/' });
byHand.push('tests/acceptance/1503/inline.test.ts', 'tests/acceptance/1676/spellings.test.ts', 'tests/acceptance/1662/ac1-tree.test.ts');

for (const entry of laneFolders.filter((folder) => !unread.includes(folder))) {
  let text = '';
  try { text = readFileSync(join(root, entry, 'lane.json'), 'utf8'); } catch {}
  const lists = laneLists(text, entry, isFile);
  for (const file of lists?.timed ?? []) if (!timed.includes(file)) timed.push(file), fromLaneFiles.timed.push(file);
  for (const file of lists?.slow ?? []) if (!slow.includes(file)) slow.push(file), fromLaneFiles.slow.push(file);
}
