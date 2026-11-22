# #3066: each alone entry, its reason and where it was read

A first reading, on main 5f5791e2d. The counts: `node scripts/lanes.mjs alone --by-reason`. "not established" marks an entry left for the owner.

| Entry | Reason | Evidence | Starts cargo itself |
|---|---|---|---|
| tests/acceptance/149/ | shared: the GPU | tests/acceptance/149/families.test.ts calls requireMetal(), tests/acceptance/149/helpers.ts's gate on macOS's Metal device |  |
| tests/acceptance/1523/ | binary | tests/acceptance/1523/helpers.ts: target/debug/deep-hook | no |
| tests/acceptance/149-redraft-ac5/ | shared: the GPU | tests/acceptance/149-redraft-ac5/seek-equals-play.test.ts calls requireMetal(), tests/acceptance/430/helpers.ts's gate on macOS's Metal device |  |
| tests/acceptance/149-redraft-ac10/ | shared: the GPU | tests/acceptance/149-redraft-ac10/target-bytes.test.ts calls requireMetal(), tests/acceptance/430/helpers.ts's gate on macOS's Metal device |  |
| tests/acceptance/84/ | binary | tests/acceptance/84/sort/helpers.ts: target/debug/deep-hook | no |
| tests/acceptance/580/ | shared: Docker | 580/helpers.ts:63-71: every file opens Bench, which runs Docker compose stacks |  |
| tests/acceptance/67/ | shared: the sandbox log stream | tests/acceptance/67/packs.test.ts calls openWorld, which opens the supervisor (tests/acceptance/67/host.ts) |  |
| tests/acceptance/66/ | shared: the sandbox log stream | tests/acceptance/66/backlog.test.ts calls gmailWorld, which opens the supervisor (tests/acceptance/66/worlds.ts) |  |
| tests/acceptance/994/hub.test.ts | binary | tests/acceptance/994/helpers.ts: run('cargo', ['build', '--locked', '-q', ...args], { env: process.env,  | yes |
| tests/acceptance/994/deadline-redraft/ | binary | tests/acceptance/994/helpers.ts: run('cargo', ['build', '--locked', '-q', ...args], { env: process.env,  | yes |
| tests/acceptance/20/ | binary | tests/acceptance/20/hub.ts: hub run` on a home, on a test clock ( (starts a hub, which runs deep-hook and deep-show from its checkout's target/: packages/hub/src/paths.ts | no |
| tests/acceptance/65/ | binary | tests/acceptance/16/helpers.ts: run('cargo', ['build', '--locked', '-q', '-p', 'deep-hook', ...extra],  | yes |
| tests/acceptance/82/ | binary | tests/acceptance/82/helpers.ts: target/debug/deep-hook | no |
| tests/acceptance/1202/ | binary | tests/acceptance/1202/helpers.ts: run('cargo', ['build', '--locked', '-q', '-p', 'deep-hook'], { timeoutM | yes |
| tests/acceptance/55/ | binary | tests/acceptance/55/gate.test.ts: run('cargo', ['build', '--locked', '-q', '-p', 'deep-hook'], { timeoutM | yes |
| tests/acceptance/103/ | shared: the sandbox log stream | its untimed files call openSupervisor; README: sandboxed through the supervisor |  |
| tests/acceptance/363/ | shared: the sandbox log stream | tests/acceptance/363/README.md: "through the supervisor" |  |
| tests/acceptance/365/ | shared: the sandbox log stream | tests/acceptance/365/README.md: "through the supervisor" |  |
| tests/acceptance/262/ | shared: the sandbox log stream | tests/acceptance/262/README.md: "through the supervisor" |  |
| tests/acceptance/366/ | shared: the sandbox log stream | 366/README.md:174: starts sandboxed plug-ins |  |
| tests/acceptance/356/ | binary | tests/acceptance/356/helpers.ts: run('cargo', ['build', '--locked', '-q', '-p', 'deep-app', '--bin', 'de | yes |
| tests/acceptance/24/ | binary | tests/acceptance/24/helpers.ts: hub run`) in a temporary home, its re (starts a hub, which runs deep-hook and deep-show from its checkout's target/: packages/hub/src/path | no |
| tests/acceptance/26/ | binary | tests/acceptance/26/helpers.ts: hub run`) in a temporary home, its re (starts a hub, which runs deep-hook and deep-show from its checkout's target/: packages/hub/src/path | no |
| tests/acceptance/1632/ | binary | tests/acceptance/1632/helpers.ts: target/debug/deep-hook) run as a hook of an agent | no |
| tests/acceptance/389/ | binary | tests/acceptance/389/helpers.ts: spawnSync('cargo', ['build', '--locked', '-p', 'deep-canvas', '--bin', 'deep- | yes |
| tests/acceptance/390/ | shared: the GPU | tests/acceptance/390/atlas.test.ts calls requireMacos(), tests/acceptance/390/helpers.ts's gate on macOS's Metal device |  |
| tests/acceptance/391/ | shared: the GPU | 391/helpers.ts:119-126: render() calls requireMacos(), the offscreen Metal renderer's gate |  |
| tests/acceptance/392/ | shared: the GPU | 392/helpers.ts:133-140: gpu() gates on the Metal renderer; status.test.ts:186 |  |
| tests/acceptance/393/ | shared: the GPU | 393/helpers.ts:503-512: screen() gates on the Metal renderer; card.test.ts:26 |  |
| tests/acceptance/394/ | binary | tests/acceptance/394/helpers.ts: spawnSync('cargo', ['build', '--locked', '--bin', name], { cwd: REPO, encodin | yes |
| tests/acceptance/305/ | binary | tests/acceptance/305/helpers.ts: `cargo build --locked --bin deep-show --no-default-f | yes |
| tests/acceptance/387/ | binary | tests/acceptance/387/helpers.ts: spawnSync('cargo', ['build', '--locked', '--bin', SHOW_NAME, '--no-default-fe | yes |
| tests/acceptance/855/ | binary | tests/acceptance/855/helpers.ts: spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024  | yes |
| tests/acceptance/857/ | binary | tests/acceptance/857/helpers.ts: spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024  | yes |
| tests/acceptance/854/ | shared: the GPU | tests/acceptance/854/replica-redraft.test.ts calls requireMac(), tests/acceptance/854/helpers.ts's gate on macOS's Metal device |  |
| tests/acceptance/1487/ | binary | tests/acceptance/1487/helpers.ts: spawnSync('cargo', ['build', '--locked', '--bin', name], { cwd: REPO, encodin | yes |
| tests/acceptance/896/ | timing | every file it holds is in the timed list |  |
| tests/acceptance/881/ | shared: the sandbox log stream | tests/acceptance/881/README.md: "through the supervisor" |  |
| tests/acceptance/411/ | shared: the sandbox log stream | tests/acceptance/411/plugin.test.ts calls loadReader, which opens the supervisor (tests/acceptance/411/helpers.ts) |  |
| tests/acceptance/488/ | binary | tests/acceptance/488/helpers.ts: spawnSync('cargo', ['build', '--locked', '--bin', SHOW_NAME, '--no-default-fe | yes |
| tests/acceptance/489/ | binary | tests/acceptance/489/helpers.ts: spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024  | yes |
| tests/acceptance/490/ | binary | tests/acceptance/490/helpers.ts: spawnSync('cargo', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024  | yes |
| tests/acceptance/490-redraft-2/ | binary | tests/acceptance/490-redraft-2/opening.test.ts: `cargo build --locked --bin deep-show --no-default-f | yes |
| tests/acceptance/490-oracle/ | binary | tests/acceptance/490-oracle/helpers.ts: spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024  | yes |
| tests/acceptance/490-oracle-redraft/ | binary | tests/acceptance/490-oracle-redraft/eases-bevy.test.ts: spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024  | yes |
| tests/acceptance/491/ | binary | tests/acceptance/491/helpers.ts: spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024  | yes |
| tests/acceptance/492/ | binary | tests/acceptance/492/helpers.ts: spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024  | yes |
| tests/acceptance/492-gaps/ | binary | tests/acceptance/492-gaps/helpers.ts: `cargo build --locked --bin <name>`, once per file;  | yes |
| tests/acceptance/493/ | binary | tests/acceptance/493/helpers.ts: spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024  | yes |
| tests/acceptance/493-redraft-ac7/ | binary | tests/acceptance/493-redraft-ac7/helpers.ts: spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024  | yes |
| tests/acceptance/493-redraft-ac12/ | binary | tests/acceptance/493-redraft-ac12/helpers.ts: spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024  | yes |
| tests/acceptance/493-redraft-ac18/ | binary | tests/acceptance/493-redraft-ac18/helpers.ts: spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024  | yes |
| tests/acceptance/494/ | binary | tests/acceptance/494/helpers.ts: spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024  | yes |
| tests/acceptance/495/ | shared: the GPU | tests/acceptance/495/echo.test.ts runs deep-gpu and never names the noop backend, so it draws on the machine's GPU |  |
| tests/acceptance/496/ | binary | tests/acceptance/496/helpers.ts: spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024  | yes |
| tests/acceptance/497/ | binary | tests/acceptance/497/helpers.ts: spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024  | yes |
| tests/acceptance/388/ | binary | tests/acceptance/388/helpers.ts: spawnSync('cargo', ['build', '--locked', '--bin', SHOW_NAME, '--no-default-fe | yes |
| tests/acceptance/16/ | timing | lanes.mjs exclusive: #16's files start real hubs and time their sockets to 2 ms |  |
| tests/acceptance/373/ | binary | tests/acceptance/373/helpers.ts: spawnSync('cargo', ['build', '--locked', '--bin', name], { cwd: REPO, encodin | yes |
| tests/acceptance/160/ | binary | tests/acceptance/160/helpers.ts: spawnSync('cargo', ['build', '--locked', '--bin', name], { cwd: REPO, encodin | yes |
| tests/acceptance/96/ | binary | tests/acceptance/96/helpers.ts: spawnSync('cargo', ['build', '--locked', '--bin', SHOW, '--bin', CANVAS], { c | yes |
| tests/acceptance/670/ | binary | tests/acceptance/670/helpers.ts: spawnSync('cargo', ['build', '--locked', '--bin', SHOW_NAME], { cwd: REPO, en | yes |
| tests/acceptance/138/ | binary | tests/acceptance/138/release.test.ts: `cargo build --release`) embeds the ledger | yes |
| tests/acceptance/185/ | binary | tests/acceptance/185/helpers.ts: `cargo build --locked [--release] --bin deep-show -- | yes |
| tests/acceptance/200/ | binary | tests/acceptance/200/helpers.ts: `cargo build --locked --bin deep-show --no-default-f | yes |
| tests/acceptance/417/ | shared: the GPU | tests/acceptance/417/switch.test.ts calls requireMac(), tests/acceptance/417/helpers.ts's gate on macOS's Metal device |  |
| tests/acceptance/418/ | shared: the GPU | tests/acceptance/418/ao.test.ts calls requireGpu(), tests/acceptance/418/helpers.ts's gate on macOS's Metal device |  |
| tests/acceptance/464/ | shared: the GPU | tests/acceptance/464/grade.test.ts calls requireGpu(), tests/acceptance/464/helpers.ts's gate on macOS's Metal device |  |
| tests/acceptance/1646/ | shared: the GPU | tests/acceptance/1646/dither.test.ts calls requireGpu(), tests/acceptance/1646/helpers.ts's gate on macOS's Metal device |  |
| tests/acceptance/1619/ | shared: the GPU | tests/acceptance/1619/identity.test.ts calls requireGpu(), tests/acceptance/1619/helpers.ts's gate on macOS's Metal device |  |
| tests/dither-fill.test.ts | shared: the GPU | tests/dither-fill.test.ts calls requireGpu(), tests/acceptance/1646/helpers.ts's gate on macOS's Metal device |  |
| tests/acceptance/467/ | shared: the GPU | tests/acceptance/467/disc.test.ts calls requireMetal(), tests/acceptance/467/helpers.ts's gate on macOS's Metal device |  |
| tests/acceptance/467-redraft-ac2/ | binary | tests/acceptance/467/helpers.ts: spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024  | yes |
| tests/acceptance/465/ | shared: the GPU | tests/acceptance/465/edge.test.ts calls requireGpu(), tests/acceptance/465/helpers.ts's gate on macOS's Metal device |  |
| tests/acceptance/166/ | shared: the GPU | tests/acceptance/166/defaults.test.ts calls requireGpu(), tests/acceptance/166/helpers.ts's gate on macOS's Metal device |  |
| tests/acceptance/268/ | shared: the GPU | tests/acceptance/268/calm.test.ts calls requireGpu(), tests/acceptance/268/helpers.ts's gate on macOS's Metal device |  |
| tests/acceptance/268-redraft-ac4/ | shared: the GPU | tests/acceptance/268-redraft-ac4/movers.test.ts calls requireGpu(), tests/acceptance/268/helpers.ts's gate on macOS's Metal device |  |
| tests/acceptance/968/ | shared: the GPU | tests/acceptance/968/channel.test.ts calls requireGpu(), tests/acceptance/968/helpers.ts's gate on macOS's Metal device |  |
| tests/acceptance/481/ | shared: the GPU | commit ec0c082c1: "GPU" |  |
| tests/acceptance/486/ | shared: the GPU | commit ef0aef924: "GPU" |  |
| tests/acceptance/221/ | binary | tests/acceptance/221/helpers.ts: spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024  | yes |
| tests/acceptance/412/ | binary | tests/acceptance/412/helpers.ts: spawnSync('cargo', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024  | yes |
| tests/acceptance/1098/budgets.test.ts | timing | every file it holds is in the timed list |  |
| tests/acceptance/1015/claude.test.ts | binary | tests/acceptance/1015/claude.test.ts: `cargo test --workspace` | yes |
| tests/acceptance/1015/codex.test.ts | binary | tests/acceptance/1015/codex.test.ts: `cargo test --workspace` is denied once, the deny g | yes |
| tests/acceptance/1015/focused.test.ts | binary | tests/acceptance/1015/focused.test.ts: `cargo test -p cart`, called by | yes |
| tests/acceptance/1015/waiter.test.ts | binary | tests/acceptance/1015/helpers.ts: 'cargo test --workspace'; | yes |
| tests/acceptance/1015/memory.test.ts | binary | tests/acceptance/1015/memory.test.ts: `cargo test --workspace`, rewritten into its | yes |
| tests/acceptance/1015/gpu.test.ts | binary | tests/acceptance/1015/helpers.ts: 'cargo test --workspace'; | yes |
| tests/acceptance/1015/redraft/own-repo.test.ts | binary | tests/acceptance/1015/helpers.ts: 'cargo test --workspace'; | yes |
| tests/acceptance/1015/budgets.test.ts | timing | every file it holds is in the timed list |  |
| tests/acceptance/1018/ | binary | tests/acceptance/875/helpers.ts: spawnSync('cargo', ['build', '-p', 'deep-hook'], { cwd: REPO, stdio: 'inherit | yes |
| tests/acceptance/1143/ | binary | tests/acceptance/1143/criteria.test.ts: run('cargo', args, repoRoot, 90 * MINUTE); | yes |
| tests/acceptance/399/ | binary | tests/acceptance/399/helpers.ts: spawnSync('cargo', args, { cwd: root, env: { ...CARGO_ENV, ...env }, encoding | yes |
| tests/acceptance/1417/ | binary | tests/acceptance/1417/helpers.ts: spawnSync('cargo', args, { cwd: root, env: CARGO_ENV, encoding: 'utf8', maxBu | yes |
| tests/acceptance/1417-redraft-ac1/ | binary | tests/acceptance/1417-redraft-ac1/helpers.ts: `cargo build --locked --bin deep-show` (debug, the d | yes |
| tests/acceptance/1417-redraft-ac3/ | timing | every file it holds is in the timed list |  |
| tests/acceptance/87/gate/ | binary | tests/acceptance/322/helpers.ts: target/debug/deep-hook | no |
| tests/acceptance/1537/ | binary | tests/acceptance/322/helpers.ts: target/debug/deep-hook | no |
| tests/acceptance/1022/ | timing | commit c3e8c09e9: "it starts hubs and deep-hook drops hooks under load" |  |
| tests/acceptance/236/ | shared: the sandbox log stream | lanes.mjs exclusive: #236's read the system's one sandbox log stream |  |
| tests/acceptance/30/ | shared: the sandbox log stream | tests/acceptance/30/README.md: "through the supervisor" |  |
| tests/acceptance/377/ | shared: the GPU | commit fa6cfcd89: "GPU" |  |
| tests/acceptance/378/ | shared: the GPU | tests/acceptance/378/anchor.test.ts calls requireGpu(), tests/acceptance/378/helpers.ts's gate on macOS's Metal device |  |
| tests/acceptance/420/ | shared: the GPU | tests/acceptance/420/edges.test.ts calls requireGpu(), tests/acceptance/420/helpers.ts's gate on macOS's Metal device |  |
| tests/acceptance/421/ | shared: the GPU | tests/acceptance/421/outline.test.ts calls requireMetal(), tests/acceptance/421/helpers.ts's gate on macOS's Metal device |  |
| tests/acceptance/423/ | shared: the GPU | tests/acceptance/423/anisotropic.test.ts calls requireMetal(), tests/acceptance/423/helpers.ts's gate on macOS's Metal device |  |
| tests/acceptance/424/ | shared: the GPU | tests/acceptance/424/additive.test.ts calls requireMetal(), tests/acceptance/424/helpers.ts's gate on macOS's Metal device |  |
| tests/acceptance/430/ | shared: the GPU | tests/acceptance/430/backdrop.test.ts calls requireMetal(), tests/acceptance/430/helpers.ts's gate on macOS's Metal device |  |
| tests/group-compositor.test.ts | shared: the GPU | tests/group-compositor.test.ts calls requireMetal(), tests/acceptance/430/helpers.ts's gate on macOS's Metal device |  |
| tests/acceptance/446/ | shared: the GPU | tests/acceptance/446/cascade-edge.test.ts calls requireMetal(), tests/acceptance/446/helpers.ts's gate on macOS's Metal device |  |
| tests/acceptance/419/ | shared: the GPU | tests/acceptance/419/camera-track.test.ts calls requireMetal(), tests/acceptance/419/helpers.ts's gate on macOS's Metal device |  |
| tests/acceptance/428/ | shared: the GPU | tests/acceptance/428/budgets.test.ts calls requireReferenceMac(), tests/acceptance/428/helpers.ts's gate on macOS's Metal device |  |
| tests/acceptance/1297/ | shared: the GPU | tests/acceptance/1297/convex-sun.test.ts calls requireMetal(), tests/acceptance/1297/helpers.ts's gate on macOS's Metal device |  |
| tests/acceptance/422/ | shared: the GPU | tests/acceptance/422/cascade-cache.test.ts calls requireMetal(), tests/acceptance/422/helpers.ts's gate on macOS's Metal device |  |
| tests/acceptance/426/ | shared: the GPU | tests/acceptance/426/background-blur.test.ts calls requireMetal(), tests/acceptance/426/helpers.ts's gate on macOS's Metal device |  |
| tests/acceptance/425/ | shared: the GPU | tests/acceptance/425/climb.test.ts calls requireMetal(), tests/acceptance/425/helpers.ts's gate on macOS's Metal device |  |
| tests/acceptance/427/ | shared: the GPU | tests/acceptance/427/deviation.test.ts calls requireMetal(), tests/acceptance/427/helpers.ts's gate on macOS's Metal device |  |
| tests/scene3d-interface.test.ts | binary | tests/acceptance/185/helpers.ts: `cargo build --locked [--release] --bin deep-show -- | yes |
| tests/scene3d-shading.test.ts | shared: the GPU | tests/scene3d-shading.test.ts calls requireReferenceMac(), tests/acceptance/421/helpers.ts's gate on macOS's Metal device |  |
| tests/scene3d-contact.test.ts | shared: the GPU | tests/scene3d-contact.test.ts calls requireMetal(), tests/acceptance/446/helpers.ts's gate on macOS's Metal device |  |
| tests/scene3d-culled-casters.test.ts | shared: the GPU | tests/scene3d-culled-casters.test.ts calls requireMetal(), tests/acceptance/446/helpers.ts's gate on macOS's Metal device |  |
| tests/acceptance/441/ | binary | tests/acceptance/441/helpers.ts: spawnSync('cargo', CARGO, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 | yes |
| tests/acceptance/440/ | binary | tests/acceptance/440/helpers.ts: spawnSync('cargo', CARGO, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 | yes |
| tests/acceptance/1640/ | shared: the GPU | tests/acceptance/1640/depth-dash.test.ts calls requireGpu(), tests/acceptance/1640/helpers.ts's gate on macOS's Metal device |  |
| tests/acceptance/1782/ | shared: the GPU | tests/acceptance/1782/dash.test.ts calls requireGpu(), tests/acceptance/1640/helpers.ts's gate on macOS's Metal device |  |
| tests/acceptance/443/ | shared: the GPU | tests/acceptance/443/taste.test.ts calls requireMetal(), tests/acceptance/443/helpers.ts's gate on macOS's Metal device |  |
| tests/acceptance/433/ | binary | tests/acceptance/433/helpers.ts: spawnSync('cargo', CARGO, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 | yes |
| tests/acceptance/671/ | shared: the GPU | commit f3c0f859b: "GPU" |  |
| tests/acceptance/1162/ | shared: the GPU | tests/acceptance/1162/status.test.ts calls requireMetal(), tests/acceptance/1162/helpers.ts's gate on macOS's Metal device |  |
| tests/acceptance/381/ | binary | tests/acceptance/381/helpers.ts: `cargo build --locked --bin <name>`; a test of | yes |
| tests/acceptance/398/ | binary | tests/acceptance/398/helpers.ts: spawnSync('cargo', ['build', '--locked', '--bin', name], { cwd: REPO, encodin | yes |
| tests/acceptance/397/ | binary | tests/acceptance/397/helpers.ts: spawnSync('cargo', args, { cwd: REPO, env: CARGO_ENV, encoding: 'utf8', maxBu | yes |
| tests/acceptance/406/ | shared: the GPU | tests/acceptance/406/story.test.ts runs deep-gpu and never names the noop backend, so it draws on the machine's GPU |  |
| tests/acceptance/238/ | shared: Docker | 238/kit.test.ts:85 calls onLinux(), 238/helpers.ts:235-269: docker run --platform linux/amd64 |  |
| tests/acceptance/415/ | binary | tests/acceptance/415/helpers.ts: spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * MIB,  | yes |
| tests/acceptance/383/ | binary | tests/acceptance/383/helpers.ts: `cargo build --locked --bin <name>`, copied out of t | yes |
| tests/acceptance/384/ | binary | tests/acceptance/384/helpers.ts: `cargo build --locked --bin deep-show`, copied out o | yes |
| tests/acceptance/400/ | binary | tests/acceptance/400/helpers.ts: `cargo build --locked --bin deep-show` once per file | yes |
| tests/acceptance/401/ | binary | tests/acceptance/401/helpers.ts: `cargo build --locked --bin deep-show` once per file | yes |
| tests/acceptance/105/ | binary | tests/acceptance/105/helpers.ts: `cargo build --locked --bin deep-show` once per file | yes |
| tests/acceptance/498/ | binary | tests/acceptance/498/capture/live.test.ts: spawnSync('cargo', ['build', '--locked', '-p', 'deep-app'], { cwd: REPO, enco | yes |
| tests/acceptance/806/ | shared: the GPU | tests/acceptance/806/closed.test.ts calls requireMacos(), tests/acceptance/806/helpers.ts's gate on macOS's Metal device |  |
| tests/acceptance/402/ | binary | tests/acceptance/402/helpers.ts: `cargo build --locked --bin deep-show` once per file | yes |
| tests/acceptance/104/ | shared: the sandbox log stream | its untimed files call openSupervisor; README: sandboxed through the supervisor |  |
| tests/acceptance/989/ | shared: the sandbox log stream | tests/acceptance/989/input.test.ts calls openWorld, which opens the supervisor (tests/acceptance/989/helpers.ts) |  |
| tests/acceptance/327/ | binary | tests/acceptance/16/helpers.ts: run('cargo', ['build', '--locked', '-q', '-p', 'deep-hook', ...extra],  | yes |
| tests/acceptance/379/ | shared: the GPU | tests/acceptance/379/allocations.test.ts calls requireMetal(), tests/acceptance/379/helpers.ts's gate on macOS's Metal device |  |
| tests/acceptance/1413/ | shared: the GPU | commit 1c9cda9a4: "GPU" |  |
| tests/acceptance/777/ | binary | tests/acceptance/777/helpers.ts: spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024  | yes |
| tests/acceptance/823/ | timing | every file it holds is in the timed list |  |
| tests/acceptance/856/ | binary | tests/acceptance/856/helpers.ts: spawnSync('cargo', ['build', '--release', '--locked', '--bin', name], { cwd:  | yes |
| tests/acceptance/14/budgets.test.ts | timing | every file it holds is in the timed list |  |
| tests/acceptance/42/budgets.test.ts | timing | every file it holds is in the timed list |  |
| tests/acceptance/62/budgets.test.ts | timing | every file it holds is in the timed list |  |
| tests/acceptance/311/redraft-ac12/budgets.test.ts | timing | every file it holds is in the timed list |  |
| tests/acceptance/28/budgets.test.ts | timing | every file it holds is in the timed list |  |
| tests/acceptance/319/budgets.test.ts | timing | every file it holds is in the timed list |  |
| tests/acceptance/331/ | shared: a fixed port | tests/acceptance/331/README.md: "listeners on ports from 3000 up, and AC10 needs 3000 itself" |  |
| tests/acceptance/37/ | shared: the sandbox log stream | tests/acceptance/37/README.md: "through the supervisor" |  |
| packages/checks-journey/test/unrun.test.ts | no reason | not established: for the owner |  |
| tests/acceptance/315/ | timing | lanes.mjs exclusive: #315's files build deep-hook and time it to 50 ms |  |
| tests/acceptance/21/replay.test.ts | timing | every file it holds is in the timed list |  |
| tests/acceptance/21/budgets.test.ts | binary | tests/acceptance/21/helpers.ts: run('cargo', ['build', '--locked', '-q', '--release', '-p', 'deep-hook' | yes |
| tests/acceptance/21/process-start.test.ts | binary | tests/acceptance/21/helpers.ts: run('cargo', ['build', '--locked', '-q', '--release', '-p', 'deep-hook' | yes |
| tests/acceptance/348/ | shared: the sandbox log stream | tests/acceptance/348/README.md: "through the supervisor" |  |
| tests/acceptance/349/ | shared: the sandbox log stream | tests/acceptance/349/README.md: "the files open hosts whose packages run check suites and the supervisor" |  |
| tests/acceptance/351/ | shared: the sandbox log stream | tests/acceptance/351/README.md: "through the supervisor" |  |
| tests/acceptance/355/ | shared: the sandbox log stream | 355/install.test.ts:54 calls openSupervisor() |  |
| tests/acceptance/884/ | binary | tests/acceptance/316/helpers.ts: run('cargo', args, { timeoutMs: 900_000 }).then((r) => { | yes |
| tests/acceptance/139/ | shared: the sandbox log stream | tests/acceptance/139/preview.test.ts calls openWorld, which opens the supervisor (tests/acceptance/139/helpers.ts) |  |
| tests/acceptance/159/budgets.test.ts | timing | every file it holds is in the timed list |  |
| tests/acceptance/761/budgets.test.ts | timing | every file it holds is in the timed list |  |
| tests/acceptance/85/budgets.test.ts | timing | every file it holds is in the timed list |  |
| tests/acceptance/666/fast.test.ts | binary | tests/acceptance/666/helpers.ts: run('cargo', args, { timeoutMs: 900_000 }).then((r) => { | yes |
| tests/acceptance/668/fast.test.ts | binary | tests/acceptance/668/helpers.ts: run('cargo', ['build', '--locked', '-q', '-p', 'deep-hook'], { cwd: REP | yes |
| tests/acceptance/567/fast.test.ts | binary | tests/acceptance/567/helpers.ts: spawnSync('cargo', ['build', '--locked', '-q', '-p', 'deep-hook'], { cwd: REP | yes |
| tests/acceptance/669/fast.test.ts | timing | every file it holds is in the timed list |  |
| tests/acceptance/1156/fast.test.ts | timing | every file it holds is in the timed list |  |
| tests/acceptance/237/ | no reason | not established: for the owner |  |
| tests/acceptance/34/ | binary | tests/acceptance/34/app.test.ts: `cargo test --locked -p deep-app --test acceptance_ | yes |
| tests/acceptance/667/ | binary | tests/acceptance/667/helpers.ts: hub run`) in a temporary home, with i (starts a hub, which runs deep-hook and deep-show from its checkout's target/: packages/hub/src/pat | no |
| tests/acceptance/380/ | shared: the GPU | tests/acceptance/380/cts-exact.test.ts calls requireGpu(), tests/acceptance/380/helpers.ts's gate on macOS's Metal device |  |
| tests/acceptance/382/ | shared: the GPU | tests/acceptance/382/art-film.test.ts calls requireGpu(), tests/acceptance/382/helpers.ts's gate on macOS's Metal device |  |
| tests/acceptance/386/ | shared: the GPU | tests/acceptance/386/outline.test.ts calls requireMetal(), tests/acceptance/386/helpers.ts's gate on macOS's Metal device |  |
| tests/acceptance/1174/ | shared: the GPU | tests/acceptance/1174/masks.test.ts calls requireReferenceMac(), tests/acceptance/1174/helpers.ts's gate on macOS's Metal device |  |
| tests/acceptance/1173/ | shared: the GPU | tests/acceptance/1173/edges-redraft.test.ts calls requireMetal(), tests/acceptance/1173/edges-redraft-helpers.ts's gate on macOS's Metal device |  |
| tests/acceptance/371/ | binary | tests/acceptance/371/helpers.ts: spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024  | yes |
| tests/acceptance/376/ | binary | tests/acceptance/376/helpers.ts: spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024  | yes |
| tests/acceptance/306/ | binary | tests/acceptance/306/helpers.ts: spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024  | yes |
| tests/acceptance/403/ | binary | tests/acceptance/403/helpers.ts: spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024  | yes |
| tests/acceptance/429/ | shared: the GPU | tests/acceptance/429/budgets.test.ts calls requireGpu(), tests/acceptance/429/helpers.ts's gate on macOS's Metal device |  |
| tests/acceptance/431/ | shared: the GPU | commit a6233c683: "GPU" |  |
| tests/acceptance/432/ | shared: the GPU | tests/acceptance/432/blur-split.test.ts calls requireGpu(), tests/acceptance/432/helpers.ts's gate on macOS's Metal device |  |
| tests/acceptance/483/ | shared: the GPU | tests/acceptance/483/arrays.test.ts calls requireGpu(), tests/acceptance/483/helpers.ts's gate on macOS's Metal device |  |
| tests/acceptance/484/ | shared: the GPU | tests/acceptance/484/counted-dispatch.test.ts calls requireGpu(), tests/acceptance/484/helpers.ts's gate on macOS's Metal device |  |
| tests/acceptance/252/ | shared: the GPU | tests/acceptance/252/machines.test.ts calls requireGpu(), tests/acceptance/252/helpers.ts's gate on macOS's Metal device |  |
| tests/acceptance/1993/ | shared: the GPU | tests/acceptance/1993/fields/bodies.test.ts calls requireGpu(), tests/acceptance/1993/fields/helpers.ts's gate on macOS's Metal device |  |
| tests/acceptance/18/kit/ | no reason | not established: for the owner |  |
| tests/acceptance/18/session/ | binary | tests/acceptance/18/session/helpers.ts: run('cargo', ['build', '--locked', '-q', '-p', 'deep-hook'], { timeoutM | yes |
| tests/acceptance/18/binding/ | binary | tests/acceptance/18/binding/helpers.ts: spawn('cargo', args, { cwd: REPO, env: { ...process.env, HOME: TOOLCHAIN_ | yes |
| tests/acceptance/18/mapping/callers.test.ts | binary | tests/acceptance/18/mapping/helpers.ts: run('cargo', ['build', '--locked', '-q', '-p', 'deep-hook', '--features | yes |
| tests/acceptance/18/mapping/failures.test.ts | binary | tests/acceptance/18/mapping/helpers.ts: run('cargo', ['build', '--locked', '-q', '-p', 'deep-hook', '--features | yes |
| tests/acceptance/18/mapping/loops.test.ts | binary | tests/acceptance/18/mapping/helpers.ts: run('cargo', ['build', '--locked', '-q', '-p', 'deep-hook', '--features | yes |
| tests/acceptance/18/mapping/mcp.test.ts | binary | tests/acceptance/18/mapping/helpers.ts: run('cargo', ['build', '--locked', '-q', '-p', 'deep-hook', '--features | yes |
| tests/acceptance/18/mapping/prompts.test.ts | binary | tests/acceptance/18/mapping/helpers.ts: run('cargo', ['build', '--locked', '-q', '-p', 'deep-hook', '--features | yes |
| tests/acceptance/18/mapping/record.test.ts | binary | tests/acceptance/18/mapping/helpers.ts: run('cargo', ['build', '--locked', '-q', '-p', 'deep-hook', '--features | yes |
| tests/acceptance/18/mapping/replies.test.ts | binary | tests/acceptance/18/mapping/helpers.ts: run('cargo', ['build', '--locked', '-q', '-p', 'deep-hook', '--features | yes |
| tests/acceptance/453/ | binary | tests/acceptance/453/helpers.ts: spawnSync('cargo', args, { cwd: REPO, env, encoding: 'utf8', maxBuffer: 64 *  | yes |
| tests/acceptance/1633/ | binary | tests/acceptance/322/helpers.ts: target/debug/deep-hook | no |
| packages/hub/test/reopened-items.test.ts | binary | tests/acceptance/322/helpers.ts: target/debug/deep-hook | no |
| tests/acceptance/46/ | binary | tests/acceptance/46/helpers.ts: 'cargo build -p deep-hook', 'cargo', ['build', '--lo | yes |
| packages/github/test/ | binary | tests/acceptance/46/helpers.ts: 'cargo build -p deep-hook', 'cargo', ['build', '--lo | yes |
| tests/acceptance/1172/ | shared: the screen | tests/acceptance/1172/shell.test.ts reads the real app's window on this Mac's screen |  |
| tests/acceptance/2078/ | binary | tests/acceptance/875/helpers.ts: spawnSync('cargo', ['build', '-p', 'deep-hook'], { cwd: REPO, stdio: 'inherit | yes |
| tests/acceptance/2218/ | binary | tests/acceptance/322/helpers.ts: target/debug/deep-hook | no |
| tests/acceptance/2698/ | timing | 2698/criteria.mjs:77-79: INCONCLUSIVE unless the load was above the core count at each run; ac1-wakeups-cpu-instructions.test.mjs:17 |  |
| tests/acceptance/2648/ | binary | tests/acceptance/16/helpers.ts: run('cargo', ['build', '--locked', '-q', '-p', 'deep-hook', ...extra],  | yes |
| tests/acceptance/1454/ | shared: the screen | commit dc0d789cf: "real-window" |  |
| tests/acceptance/1459/ | shared: the screen | tests/acceptance/1459/identifier.test.ts reads the real app's window on this Mac's screen |  |
| tests/acceptance/1463/ | timing | 1463/budget.test.ts:62 calls timingProblem() (1551/helpers.ts) and goes INCONCLUSIVE under load; the file is not in timed |  |
| tests/acceptance/1002/first-screen-redraft/ | shared: the screen | tests/acceptance/1002/first-screen-redraft/first-screen.test.ts reads the real app's window on this Mac's screen |  |
| tests/acceptance/994/first-screen-redraft/ | shared: the screen | tests/acceptance/994/first-screen-redraft/first-screen.test.ts reads the real app's window on this Mac's screen |  |
| tests/acceptance/167/ | binary | tests/acceptance/167/helpers.ts: `cargo build --locked --bin deep-canvas-render [--re | yes |
| tests/acceptance/1328/ | binary | tests/acceptance/1328/helpers.ts: hub run --root`, with the real (starts a hub, which runs deep-hook and deep-show from its checkout's target/: packages/hub/src/paths.ts, | no |
| tests/acceptance/18/install/coexist.test.ts | binary | tests/acceptance/18/install/helpers.ts: run('cargo', args, { timeoutMs: 1_200_000 }).then((r) => { | yes |
| tests/acceptance/18/install/disable.test.ts | binary | tests/acceptance/18/install/helpers.ts: run('cargo', args, { timeoutMs: 1_200_000 }).then((r) => { | yes |
| tests/acceptance/18/install/install.test.ts | binary | tests/acceptance/18/install/helpers.ts: run('cargo', args, { timeoutMs: 1_200_000 }).then((r) => { | yes |
| tests/acceptance/18/install/stophold.test.ts | binary | tests/acceptance/18/install/helpers.ts: run('cargo', args, { timeoutMs: 1_200_000 }).then((r) => { | yes |
| tests/acceptance/18/install/tamper.test.ts | binary | tests/acceptance/18/install/helpers.ts: run('cargo', args, { timeoutMs: 1_200_000 }).then((r) => { | yes |
| tests/acceptance/18/install/waiter.test.ts | binary | tests/acceptance/18/install/helpers.ts: run('cargo', args, { timeoutMs: 1_200_000 }).then((r) => { | yes |
| tests/acceptance/19/ | binary | tests/acceptance/19/status/helpers.ts: 'cargo test', `call_${n}`); | yes |
| tests/acceptance/1312/ | shared: the GPU | tests/acceptance/1312/repro.test.ts calls requireDrawingPlatform(), tests/acceptance/1312/helpers.ts's gate on macOS's Metal device |  |
| tests/acceptance/629/ | binary | tests/acceptance/629/helpers.ts: `cargo build --locked --bin <bin>` in the | yes |
| tests/acceptance/25/routes/ | binary | tests/acceptance/25/routes/helpers.ts: run('cargo', args, { timeoutMs: 1_200_000 }).then((r) => { | yes |
| tests/acceptance/25/fallbacks/ | binary | tests/acceptance/25/fallbacks/helpers.ts: run('cargo', args, { timeoutMs: 1_200_000 }).then((r) => { | yes |
| tests/acceptance/25/live/budgets.test.ts | timing | every file it holds is in the timed list |  |
| tests/acceptance/321/ | binary | tests/acceptance/321/helpers.ts: target/debug/deep-hook | no |
| tests/acceptance/303/ | binary | tests/acceptance/303/helpers.ts: target/debug/deep-hook | no |
| tests/acceptance/344/ | binary | tests/acceptance/316/helpers.ts: run('cargo', args, { timeoutMs: 900_000 }).then((r) => { | yes |
| tests/acceptance/1514/ | binary | tests/acceptance/19/doctor/helpers.ts: run('cargo', args, { timeoutMs: 1_200_000 }).then((r) => { | yes |
| tests/acceptance/322/ | binary | tests/acceptance/322/helpers.ts: target/debug/deep-hook | no |
| tests/acceptance/323/ | binary | tests/acceptance/323/helpers.ts: target/debug/deep-hook | no |
| tests/acceptance/324/ | binary | tests/acceptance/324/helpers.ts: target/debug/deep-hook | no |
| tests/acceptance/325/ | binary | tests/acceptance/325/helpers.ts: target/debug/deep-hook | no |
| tests/acceptance/347/ | binary | tests/acceptance/347/commands.test.ts: `cargo build`, run from scripts this session didn't  | yes |
| tests/acceptance/340/ | binary | tests/acceptance/340/app/helpers.ts: run('cargo', args, { timeoutMs: 1_200_000 }).then((r) => { | yes |
| tests/acceptance/29/hub.test.ts | binary | tests/acceptance/29/hub.test.ts: `cargo build -p deep-hook`; a hub | yes |
| tests/acceptance/29/slots.test.ts | binary | tests/acceptance/29/h-d.ts: target/debug/deep-hook | no |
| tests/acceptance/907/slots.test.ts | binary | tests/acceptance/18/mapping/helpers.ts: run('cargo', ['build', '--locked', '-q', '-p', 'deep-hook', '--features | yes |
| tests/acceptance/907/background.test.ts | binary | tests/acceptance/18/mapping/helpers.ts: run('cargo', ['build', '--locked', '-q', '-p', 'deep-hook', '--features | yes |
| tests/acceptance/965/ | binary | tests/acceptance/29/h-d.ts: target/debug/deep-hook | no |
| tests/acceptance/996/ | shared: the sandbox log stream | 996/README.md:31: hubs and sandboxed processes by the dozen |  |
| packages/hub/test/loop-starters.test.ts | binary | tests/acceptance/29/h-d.ts: target/debug/deep-hook | no |
| packages/hub/test/loop-transcript.test.ts | binary | tests/acceptance/29/h-d.ts: target/debug/deep-hook | no |
| tests/acceptance/29/budgets.test.ts | timing | every file it holds is in the timed list |  |
| tests/acceptance/1175/ | binary | tests/acceptance/1175/helpers.ts: spawnSync('cargo', ['build', '--locked', '-p', 'deep-marks-render', '--bin',  | yes |
| tests/acceptance/23/permissions/ | binary | tests/acceptance/23/permissions/helpers.ts: target/debug/deep-hook | no |
| tests/acceptance/23/match/budgets.test.ts | timing | every file it holds is in the timed list |  |
| tests/acceptance/83/ | binary | tests/acceptance/83/helpers.ts: 'cargo build -p deep-hook', 'cargo', ['build', '--lo | yes |
| tests/acceptance/120/budgets.test.ts | timing | every file it holds is in the timed list |  |
| tests/acceptance/120/budgets-idle-redraft.test.ts | timing | every file it holds is in the timed list |  |
| tests/acceptance/352/ | binary | tests/acceptance/352/helpers.ts: target/debug/deep-hook | no |
| tests/acceptance/27/wake.test.ts | binary | tests/acceptance/27/helpers.ts: run('cargo', args, { timeoutMs: 1_200_000 }).then((r) => { | yes |
| tests/acceptance/27/repeat.test.ts | binary | tests/acceptance/27/helpers.ts: run('cargo', args, { timeoutMs: 1_200_000 }).then((r) => { | yes |
| tests/acceptance/27/waits.test.ts | binary | tests/acceptance/27/README.md: "its files start hubs"; a hub runs deep-hook from its checkout's target/ (#2817) | no |
| tests/acceptance/27/budgets.test.ts | timing | every file it holds is in the timed list |  |
| tests/acceptance/27/outcomes-redraft/ | binary | tests/acceptance/27/helpers.ts: run('cargo', args, { timeoutMs: 1_200_000 }).then((r) => { | yes |
| tests/acceptance/27/desktop-redraft-2/ | binary | tests/acceptance/27/helpers.ts: run('cargo', args, { timeoutMs: 1_200_000 }).then((r) => { | yes |
| tests/acceptance/124/ | shared: the GPU | tests/acceptance/124/ac1-replay.test.ts calls requireMacos(), tests/acceptance/124/helpers.ts's gate on macOS's Metal device |  |
| tests/acceptance/906/ | binary | tests/acceptance/906/helpers.ts: run('cargo', ['build', '--locked', '-q', '-p', 'deep-hook'], { timeoutM | yes |
| packages/hub/test/drive.test.ts | binary | tests/acceptance/124/helpers.ts: spawnSync('cargo', ['build', '--locked', '-p', 'deep-replica', '--bin', DRIVE | yes |
| tests/acceptance/990/ | binary | tests/acceptance/402/helpers.ts: `cargo build --locked --bin deep-show` once per file | yes |
| tests/acceptance/140/gpu/ | shared: the GPU | tests/acceptance/140/gpu/adapters.test.ts calls requireMac(), tests/acceptance/140/gpu/helpers.ts's gate on macOS's Metal device |  |
| tests/acceptance/140/view/ | shared: the GPU | tests/acceptance/140/view/backends.test.ts runs deep-gpu and never names the noop backend, so it draws on the machine's GPU |  |
| tests/acceptance/140/platform/ | binary | tests/acceptance/140/platform/wasm.test.ts: `cargo build --locked --target ${TARGET} -p ${core.j | yes |
| tests/acceptance/309/ | binary | tests/acceptance/309/helpers.ts: `cargo build --locked`), copied out of target/debug  | yes |
| tests/acceptance/385/ | shared: the GPU | tests/acceptance/385/blend.test.ts runs deep-gpu and never names the noop backend, so it draws on the machine's GPU |  |
| tests/acceptance/874/redraft/ | binary | tests/acceptance/29/h-d.ts: target/debug/deep-hook | no |
| tests/acceptance/824/cycles.test.ts | binary | tests/acceptance/824/helpers.ts: hub run` and (starts a hub, which runs deep-hook and deep-show from its checkout's target/: packages/hub/src/paths.ts, #2817) | no |
| tests/acceptance/824/planted.test.ts | binary | tests/acceptance/824/helpers.ts: hub run` and (starts a hub, which runs deep-hook and deep-show from its checkout's target/: packages/hub/src/paths.ts, #2817) | no |
| tests/acceptance/824/leftovers.test.ts | binary | tests/acceptance/824/helpers.ts: hub run` and (starts a hub, which runs deep-hook and deep-show from its checkout's target/: packages/hub/src/paths.ts, #2817) | no |
| tests/acceptance/824/sessions/readings.test.ts | binary | tests/acceptance/824/sessions/readings.test.ts: hub run\b/], ['deep mcp', /\bmcp$/],  (starts a hub, which runs deep-hook and deep-show from its checkout's target/: packa | no |
| tests/acceptance/824/sessions/planted.test.ts | binary | tests/acceptance/824/helpers.ts: hub run` and (starts a hub, which runs deep-hook and deep-show from its checkout's target/: packages/hub/src/paths.ts, #2817) | no |
| tests/acceptance/1285/ | shared: the GPU | tests/acceptance/1285/box.test.ts calls requireMetal(), tests/acceptance/422/helpers.ts's gate on macOS's Metal device |  |
| tests/acceptance/1294/ | binary | tests/acceptance/1294/helpers.ts: target/debug/deep-hook | no |
| tests/acceptance/1507/ | binary | tests/acceptance/1507/helpers.ts: target/debug/deep-hook | no |
| tests/acceptance/1998/ | binary | tests/acceptance/1998/helpers.ts: run('cargo', ['build', '--locked', '-q', '-p', 'deep-hook'], { cwd: REP | yes |
| tests/acceptance/1999/ | binary | tests/acceptance/1999/helpers.ts: target/debug/deep-hook | no |
| tests/acceptance/1848/ | binary | tests/acceptance/1848/helpers.ts: run('cargo', args, { timeoutMs: 900_000 }).then((r) => { | yes |
| tests/acceptance/2653/ | binary | tests/acceptance/16/helpers.ts: run('cargo', ['build', '--locked', '-q', '-p', 'deep-hook', ...extra],  | yes |
| tests/acceptance/1868/ | timing | every file it holds is in the timed list |  |
| tests/acceptance/1868-redraft-ac2/ | binary | 1868-redraft-ac2/helpers.ts startHub spawns deep hub run (a hub runs deep-hook from its checkout target/) | yes |
| tests/acceptance/1334-redraft-2565/ | binary | tests/acceptance/1334/helpers.mjs: 'target', 'debug', 'deep-hook'); | no |
| tests/acceptance/1217/ | shared: the GPU | tests/acceptance/1217/lane.json: "GPU" |  |
| tests/acceptance/1255/ | shared: Docker | tests/acceptance/1255/lane.json: "Docker" |  |
| tests/acceptance/2573/ | timing | tests/acceptance/2573/lane.json: "holds a real hub exit for 10 s and reads its exit code, so timing matters" |  |
| tests/acceptance/2694/ | shared: the GPU | 2694/lane.json: ac5-393 and ac5-806 run #393 and #806 folders, whose helpers gate on the Metal renderer |  |
| tests/acceptance/3023/ | shared: the GPU | tests/acceptance/3023/lane.json: "Metal" |  |
| tests/acceptance/33/ | binary | tests/acceptance/322/helpers.ts: target/debug/deep-hook | no |
| tests/acceptance/1427/ | shared: the GPU | 1427/ac1-journeys.test.ts:12 calls requireMacos(), 124/helpers.ts:68's gate on GPUI's offscreen Metal renderer |  |
| tests/acceptance/1550/ | shared: the GPU | tests/acceptance/1550/shown.test.ts calls requireMacos(), tests/acceptance/124/helpers.ts's gate on macOS's Metal device |  |
| tests/acceptance/533/ | binary | tests/acceptance/533/helpers.ts: spawnSync('cargo', args, { cwd, encoding: 'utf8', maxBuffer: 64 * MIB, env: { | yes |
| tests/acceptance/194/ | shared: Docker | 194/ac01-layout.test.ts:107 calls packOnLinux(), 194/helpers.ts:377-410 |  |
| tests/acceptance/194-oracle/ | binary | tests/acceptance/194/helpers.ts: `cargo build --locked -p deep-catalog --bin deep-cat | yes |
| tests/acceptance/194-redraft-ac11/ | timing | every file it holds is in the timed list |  |
| tests/acceptance/832/ | shared: the sandbox log stream | tests/acceptance/832/ac01-dominant.test.ts calls openHub, which opens the supervisor (tests/acceptance/832/helpers.ts) |  |
| tests/acceptance/1434/ | shared: the GPU | 1434/ac5-unchanged.test.ts:33-35 runs tests/acceptance/377/handoff.test.ts, #377's GPU file |  |
| tests/acceptance/1482/ | shared: the GPU | 1482/access.test.ts:26 calls 124/helpers.ts:68's gate on GPUI's offscreen Metal renderer |  |
| tests/acceptance/177/ | shared: the GPU | its window files run by hand; the alone run drives deep-gpu |  |
| tests/acceptance/177-redraft-ac3/ | shared: the GPU | 177-redraft-ac3/ac3-sdr-outputs.test.ts uses a stub display and drives deep-gpu |  |
| tests/acceptance/1436/ | shared: the GPU | its live files run by hand; the alone run drives deep-gpu |  |
| tests/acceptance/1485/ | shared: the GPU | 1485/decode.test.ts:3-5, upload.test.ts:1-4 draw on Vello GPU or GPUI; its window files are timed or by hand |  |
| tests/acceptance/1486/ | shared: the GPU | 1486/helpers.ts:680 useRender; levels.test.ts:13 |  |
| tests/acceptance/2494/ | shared: the screen | lanes.mjs:298: "open the app" |  |
| tests/acceptance/1485-redraft-ac2/ | shared: the GPU | 1485-redraft-ac2/helpers.ts:226 onlyOnMacos, cap.test.ts:107 |  |
| tests/acceptance/1493/word.test.ts | binary | tests/acceptance/1493/helpers.ts: spawnSync('cargo', CARGO, { | yes |
| tests/acceptance/1493/recipe.test.ts | binary | tests/acceptance/1493/helpers.ts: spawnSync('cargo', CARGO, { | yes |
| tests/acceptance/1493/document.test.ts | binary | tests/acceptance/1493/helpers.ts: spawnSync('cargo', CARGO, { | yes |
| tests/acceptance/1493-redraft-ac1/ | no reason | not established: for the owner |  |
| tests/acceptance/1515/ | binary | tests/acceptance/16/helpers.ts: run('cargo', ['build', '--locked', '-q', '-p', 'deep-hook', ...extra],  | yes |
| tests/acceptance/1546/ | shared: the GPU | 1546/ac1-journey.test.ts:19 calls 124/helpers.ts:68's gate on GPUI's offscreen Metal renderer |  |
| tests/acceptance/1348/ | binary | lanes.mjs site comment: "runs the plain words lane, which builds and draws its fixture run in the replica" (the lane's cargo build -p deep-replica) | no |
| tests/acceptance/1455/ | shared: the screen | tests/acceptance/1455/pictures.test.ts reads the real app's window on this Mac's screen |  |
| tests/acceptance/505/ | binary | tests/acceptance/505/helpers.ts: spawnSync('cargo', args, { cwd: REPO, env: CARGO_ENV, encoding: 'utf8', maxBu | yes |
| tests/acceptance/505-oracle/ | binary | tests/acceptance/505-oracle/helpers.ts: spawnSync('cargo', args, { cwd: REPO, env: CARGO_ENV, encoding: 'utf8', maxBu | yes |
| tests/acceptance/1653/ | binary | tests/acceptance/467/helpers.ts: spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024  | yes |
| tests/acceptance/1653-redraft-ac2-flip/ | binary | tests/acceptance/467/helpers.ts: spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024  | yes |
| tests/acceptance/536/ | binary | tests/acceptance/536/helpers.ts: spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024  | yes |
| tests/acceptance/535/ | shared: the GPU | lanes.mjs:332: "GPU" |  |
| tests/acceptance/1479/ | shared: the GPU | lanes.mjs comment: draws with GPUI's offscreen renderer, as #385's do; 1479/helpers.ts:112 needsMac |  |
| tests/acceptance/531/ | shared: Docker | lanes.mjs:336: "Docker" |  |
| tests/acceptance/531-redraft-ac11/ | binary | tests/acceptance/531-redraft-ac11/budget-lines.test.ts: spawnSync('cargo', ['build', '--locked', '--release', '--target', 'wasm32-unk | yes |
| tests/acceptance/531-redraft-ac12/ | binary | tests/acceptance/531/helpers.ts: spawnSync('cargo', args, { cwd, encoding: 'utf8', maxBuffer: 64 * MIB, env: { | yes |
| tests/acceptance/499/ | shared: the GPU | 499/video/shader.test.ts:24 via liveViewProblem, 499/video/helpers.ts:556-558 |  |
| tests/acceptance/500/ | binary | tests/acceptance/500/spawn/helpers.ts: `cargo build --locked --bin deep-show` once per file | yes |
| tests/acceptance/500-oracle/ | binary | tests/acceptance/500/bake/helpers.ts: `cargo build --locked --bin deep-show` once per file | yes |
| tests/acceptance/532/ | shared: Docker | lanes.mjs:344: "Docker" |  |
| tests/acceptance/545/ | shared: the GPU | lanes.mjs:346: "GPU" |  |
| tests/acceptance/545-redraft-ac3/ | binary | 545-redraft-ac3/README.md:41-43: no GPU or deep-show is needed; alone because each builds a cargo binary | yes |
| tests/acceptance/545-redraft-ac5/ | binary | 545-redraft-ac5/README.md:37-39: no GPU or deep-show is needed; alone because each builds a cargo binary | yes |
| tests/acceptance/1731/ | shared: the sandbox log stream | lanes.mjs:348: "through the supervisor" |  |
| tests/acceptance/534/ | binary | tests/acceptance/534/helpers.ts: spawnSync('cargo', args, { cwd, encoding: 'utf8', maxBuffer: 64 * MIB, env: { | yes |
| tests/acceptance/1820/ | shared: the sandbox log stream | lanes.mjs site comment: the same real hub and sandboxed library fixture as #1731 |  |
| tests/acceptance/1732/ | binary | tests/acceptance/1732/helpers.ts: spawnSync('cargo', BUILD, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 | yes |
| tests/acceptance/190/ | shared: Docker | lanes.mjs:358: "Docker" |  |
| tests/acceptance/416/interfaces/ | shared: Docker | lanes.mjs:361: "Docker" |  |
| tests/acceptance/1477/ | timing | every file it holds is in the timed list |  |
| tests/acceptance/2569/ | timing | every file it holds is in the timed list |  |
| tests/acceptance/1718/ | binary | tests/acceptance/1718/helpers.ts: `cargo build --locked --bin <each>`: the hub refuses | yes |
| tests/acceptance/1637/ | shared: the GPU | lanes.mjs:379: "Metal" |  |
| tests/acceptance/1634/ | shared: the GPU | lanes.mjs:382: "Metal" |  |
| tests/acceptance/1458/ | binary | tests/acceptance/1458/helpers.ts: run('cargo', ['build', '--locked', '-q', ...args], { env: CARGO_ENV, ti | yes |
| tests/acceptance/501/ | shared: the GPU | lanes.mjs:389: "GPU" |  |
| tests/acceptance/501-redraft-ac10/ | shared: Docker | 501-redraft-ac10/README.md:61,89: builds for linux/amd64 in the container; BLOCKED when Docker is unreachable |  |
| tests/acceptance/1818/ | binary | tests/acceptance/1818/helpers.ts: `cargo build --locked --bin deep-show` once per file | yes |
| tests/acceptance/1720/ | binary | tests/acceptance/1720/helpers.ts: `cargo build --locked --bin <each>`: the hub refuses | yes |
| tests/acceptance/1718-redraft-1720/ | binary | tests/acceptance/1718/helpers.ts: `cargo build --locked --bin <each>`: the hub refuses | yes |
| tests/acceptance/1461/ | binary | tests/acceptance/16/helpers.ts: run('cargo', ['build', '--locked', '-q', '-p', 'deep-hook', ...extra],  | yes |
| tests/acceptance/1100/ | binary | tests/acceptance/1100/helpers.ts: execFile('cargo', ['build', '--locked', '-q', ...args], { cwd: REPO, env: CA | yes |
| tests/acceptance/2018/ | binary | tests/acceptance/2018/helpers.ts: execFileSync('cargo', ['build', '--locked', '-q', ...args], { cwd: REPO, env: CA | yes |
| tests/acceptance/2019/ | binary | tests/acceptance/16/helpers.ts: run('cargo', ['build', '--locked', '-q', '-p', 'deep-hook', ...extra],  | yes |
| tests/acceptance/1922/ | shared: the sandbox log stream | lanes.mjs:411: "through the supervisor" |  |
| tests/acceptance/1924/ | shared: the sandbox log stream | 1924/README.md:56: every test starts its own hub, which starts sandboxed plug-ins through the supervisor |  |
| tests/acceptance/1923/ | shared: the sandbox log stream | 1923/README.md: the tool runs through the supervisor in the platform sandbox |  |
| tests/acceptance/1942/ | shared: the Lima VMs | lanes.mjs:420: "Lima VMs" |  |
| tests/acceptance/1945/ | shared: the Lima VMs | lanes.mjs:424: "Lima VMs" |  |
| tests/acceptance/1946/ | shared: the Lima VMs | lanes.mjs:427: "Lima VMs" |  |
| tests/acceptance/1943/ | shared: the Lima VMs | lanes.mjs:430: "Lima VMs" |  |
| tests/acceptance/1983/ | shared: Docker | lanes.mjs:433: "linux/amd64 and linux/arm64 containers" |  |
| tests/acceptance/1462/ | shared: the screen | lanes.mjs:437: "open the real app" |  |
| tests/acceptance/1462-redraft-ac2/ | shared: the screen | lanes.mjs:437: "open the real app" |  |
| tests/acceptance/1901/ | shared: the checkout's source files | lanes.mjs site comment: a file builds deep-show with a source file changed for that build and restored after it, "so nothing else may build in the checkout while it runs" |  |
| tests/acceptance/1925/ | shared: the sandbox log stream | lanes.mjs:444: "through the supervisor" |  |
| tests/acceptance/408/crossing.test.ts | binary | tests/acceptance/408/helpers.ts: spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024  | yes |
| tests/acceptance/408/overlap-covered.test.ts | binary | tests/acceptance/408/helpers.ts: spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024  | yes |
| tests/acceptance/408/cut.test.ts | binary | tests/acceptance/408/helpers.ts: spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024  | yes |
| tests/acceptance/408/module-label.test.ts | binary | tests/acceptance/408/helpers.ts: spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024  | yes |
| tests/acceptance/408-redraft-ac5/ | timing | every file it holds is in the timed list |  |
| tests/acceptance/1819/ | shared: a fixed port | lanes.mjs:453: "fixed port 8719" |  |
| tests/acceptance/502/ | shared: the GPU | lanes.mjs:456: "GPU" |  |
| tests/acceptance/502-oracle/ | shared: the GPU | lanes.mjs:456: "GPU" |  |
| tests/acceptance/503/ | shared: the GPU | lanes.mjs:460: "GPU" |  |
| tests/acceptance/503-oracle/ | binary | its four files decode audio through the worker, none draws; 499/video/helpers.ts: cargo build --locked --bin | yes |
| tests/acceptance/503-redraft-ac1/ | binary | 503-redraft-ac1/README.md:46: builds a cargo binary; :139: no GPU enters the readings | yes |
| tests/acceptance/935/ | shared: a fixed port | lanes.mjs:466: "fixed port 8719" |  |
| tests/acceptance/935-oracle/ | binary | 935-oracle/README.md:55-57: the file builds deep-show once with cargo | yes |
| tests/acceptance/405/broken-fixture.test.ts | binary | tests/acceptance/405/helpers.ts: spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024  | yes |
| tests/acceptance/405/floating-exception.test.ts | binary | tests/acceptance/405/helpers.ts: spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024  | yes |
| tests/acceptance/405/lid-sweep.test.ts | binary | tests/acceptance/405/helpers.ts: spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024  | yes |
| tests/acceptance/405-redraft-ac4/ | timing | every file it holds is in the timed list |  |
| tests/acceptance/1936/ | binary | tests/acceptance/1936/helpers.ts: spawnSync('cargo', CARGO_ARGS, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * | yes |
| tests/acceptance/1935/ | binary | tests/acceptance/1935/helpers.ts: spawnSync('cargo', CARGO_ARGS, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * | yes |
| tests/acceptance/1938/machines.test.ts | shared: the GPU | lanes.mjs:482: "GPU" |  |
| tests/acceptance/1938-redraft-contrast/ | binary | 1938-redraft-contrast/README.md:66-71: builds deep-show | yes |
| tests/acceptance/1939/ | shared: the GPU | lanes.mjs:486: "GPU" |  |
| tests/acceptance/2513/ | shared: the GPU | lanes.mjs:490: "GPU" |  |
| tests/acceptance/3017/ | shared: the GPU | lanes.mjs:494: "GPU" |  |
| tests/acceptance/456/ | shared: the GPU | lanes.mjs:498: "GPU" |  |
| tests/acceptance/544/ | shared: the GPU | lanes.mjs:500: "GPU" |  |
| tests/acceptance/202/ | binary | tests/acceptance/202/helpers.ts: `cargo build --locked --bin deep-show --no-default-f | yes |
| tests/acceptance/1971/ | binary | tests/acceptance/1971/helpers.ts: spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024  | yes |
| tests/acceptance/1972/ | binary | tests/acceptance/1972/helpers.ts: spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 256 * 1024 | yes |
| tests/acceptance/1973/ | binary | tests/acceptance/1973/helpers.ts: spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024  | yes |
| tests/acceptance/1974/ | binary | tests/acceptance/1974/helpers.ts: spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024  | yes |
| tests/acceptance/2717/ | binary | tests/acceptance/2717/helpers.ts: spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024  | yes |
| tests/acceptance/1957/ | binary | tests/acceptance/1957/helpers.ts: `cargo build --locked --bin deep-show --no-default-f | yes |
| tests/acceptance/1961/ | binary | tests/acceptance/1961/helpers.ts: `cargo build --locked --bin deep-show --no-default-f | yes |
| tests/acceptance/1399/ | binary | tests/acceptance/1399/helpers.ts: spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024  | yes |
| tests/acceptance/2015/ | binary | tests/acceptance/2015/helpers.ts: spawnSync('cargo', CARGO, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 | yes |
| tests/acceptance/220/ | shared: Docker | 220/parts.test.ts:88 calls runToolOnLinux(), 220/helpers.ts:429-459 |  |
| tests/acceptance/1976/ | shared: the GPU | tests/acceptance/1976/hit-path.test.ts calls requireMetal(), tests/acceptance/1976/helpers.ts's gate on macOS's Metal device |  |
| tests/acceptance/1405/ | timing | lanes.mjs site comment: "read a two-thread bench's count at load above the cores" |  |
| tests/acceptance/724-redraft-1405/ | timing | every file it holds is in the timed list |  |
| tests/acceptance/1575/ | binary | tests/acceptance/16/helpers.ts: run('cargo', ['build', '--locked', '-q', '-p', 'deep-hook', ...extra],  | yes |
| tests/acceptance/1575-redraft-ac1/ | timing | every file it holds is in the timed list |  |
| tests/acceptance/1964/ | binary | tests/acceptance/467/helpers.ts: spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024  | yes |
| tests/acceptance/1965/ | binary | tests/acceptance/467/helpers.ts: spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024  | yes |
| tests/acceptance/1965-oracle/ | binary | tests/acceptance/467/helpers.ts: spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024  | yes |
| tests/acceptance/1963/ | binary | tests/acceptance/1963/helpers.ts: spawnSync('cargo', args, { cwd: REPO, env, encoding: 'utf8', maxBuffer: 256 * | yes |
| tests/acceptance/1723/ | binary | tests/acceptance/1723/helpers.ts: target/release and target/debug | no |
| tests/acceptance/2205/ | binary | tests/acceptance/2205/helpers.ts: 'cargo build --locked -p deep-hook']] as const) { | yes |
| tests/acceptance/504/ | binary | tests/acceptance/504/helpers.ts: spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024  | yes |
| tests/acceptance/504-redraft-ac1/ | binary | tests/acceptance/504-redraft-ac1/helpers.ts: spawnSync('cargo', ARGS, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * MIB,  | yes |
| tests/acceptance/504-redraft-ac2/ | binary | tests/acceptance/384/helpers.ts: `cargo build --locked --bin deep-show`, copied out o | yes |
| tests/acceptance/504-redraft-ac8/ | binary | tests/acceptance/504-redraft-ac8/helpers.ts: `cargo build --locked --bin deep-motion` once per fi | yes |
| tests/acceptance/2026/ | binary | tests/acceptance/2026/helpers.ts: run('cargo', ['build', '--locked', '-q', ...args], { env: { ...process. | yes |
| tests/acceptance/2026-redraft-ac3/ | timing | every file it holds is in the timed list |  |
| tests/acceptance/2028/ | binary | tests/acceptance/16/helpers.ts: run('cargo', ['build', '--locked', '-q', '-p', 'deep-hook', ...extra],  | yes |
| tests/acceptance/2021/ | binary | tests/acceptance/2021/helpers.ts: execFile('cargo', ['build', '--locked', '-q', ...args], { cwd: REPO, env: CA | yes |
| tests/acceptance/2029/ | binary | tests/acceptance/2029/helpers.ts: 'cargo build --locked -q'; | yes |
| tests/acceptance/1101/ | binary | tests/acceptance/1101/helpers.ts: 'cargo build --locked -q -p deep-hook --bin deep-hoo | yes |
| tests/acceptance/1056/ | shared: the GPU | tests/acceptance/1056/no-record.test.ts calls requireGpu(), tests/acceptance/1056/helpers.ts's gate on macOS's Metal device |  |
| tests/acceptance/1897/ | shared: the GPU | lanes.mjs:577: "GPU" |  |
| tests/acceptance/1899/ | binary | 1899/helpers.ts:125 runs deep-gpu on the noop backend only (README:59-61); helpers.ts builds it with cargo | yes |
| tests/acceptance/1903/ | shared: the GPU | lanes.mjs:577: "GPU" |  |
| tests/acceptance/2189/ | shared: the GPU | lanes.mjs:578: "GPU" |  |
| tests/acceptance/2189-redraft-ac1/ | shared: the GPU | lanes.mjs:578: "GPU" |  |
| tests/acceptance/2189-redraft-ac3/ | shared: the GPU | lanes.mjs:578: "GPU" |  |
| tests/acceptance/2691/ | shared: the GPU | lanes.mjs:578: "GPU" |  |
| tests/acceptance/2009/ | binary | lanes.mjs site comment: "every file builds deep-physics on Rapier"; the containers are #2010's and #2012's | yes |
| tests/acceptance/2009-redraft-ac2/ | binary | lanes.mjs site comment: "every file builds deep-physics on Rapier"; the containers are #2010's and #2012's | yes |
| tests/acceptance/2010/ | shared: Docker | lanes.mjs:583: "linux/amd64 and linux/arm64 containers" |  |
| tests/acceptance/2010-oracle/ | binary | tests/acceptance/2010/helpers.ts: spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 512 * MIB, | yes |
| tests/acceptance/2011/ | binary | tests/acceptance/2009/helpers.ts: `cargo build --locked --bin deep-physics`, once per  | yes |
| tests/acceptance/2012/ | shared: Docker | lanes.mjs:584: "linux/amd64 and linux/arm64 containers" |  |
| tests/acceptance/2012-oracle/ | shared: Docker | lanes.mjs:584: "linux/amd64 and linux/arm64 containers" |  |
| tests/acceptance/547/ | binary | tests/acceptance/547/helpers.ts: spawnSync('cargo', args, { cwd, encoding: 'utf8', maxBuffer: 64 * MIB, env: { | yes |
| tests/acceptance/1967/ | shared: the GPU | lanes.mjs:590: "GPU" |  |
| tests/acceptance/407/ | binary | tests/acceptance/407/helpers.ts: spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024  | yes |
| tests/acceptance/407-oracle/ | binary | tests/acceptance/407/helpers.ts: spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024  | yes |
| tests/acceptance/2014/ | binary | tests/acceptance/2014/helpers.ts: spawnSync('cargo', CARGO_ARGS, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * | yes |
| tests/acceptance/2014-oracle/ | binary | tests/acceptance/2014/helpers.ts: spawnSync('cargo', CARGO_ARGS, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * | yes |
| tests/acceptance/1956/ | binary | tests/acceptance/1956/helpers.ts: `cargo build --locked --bin deep-show --no-default-f | yes |
| tests/acceptance/1959/ | binary | tests/acceptance/1959/helpers.ts: `cargo build --locked --bin deep-show --no-default-f | yes |
| tests/acceptance/1960/ | binary | tests/acceptance/1960/helpers.ts: `cargo build --locked --bin deep-show --no-default-f | yes |
| tests/acceptance/1962/ | binary | tests/acceptance/1962/helpers.ts: `cargo build --locked --bin deep-show --no-default-f | yes |
| tests/acceptance/1802/ | binary | tests/acceptance/1802/helpers.ts: `cargo build --locked --bin deep-show --no-default-f | yes |
| tests/acceptance/139-redraft-1802/ | binary | lanes.mjs site comment: "the redraft runs as #139's suite does", and #139's helpers build with cargo | no |
| tests/acceptance/154/ | shared: the sandbox log stream | lanes.mjs:609: "through the supervisor" |  |
| tests/acceptance/154-oracle/ | shared: the sandbox log stream | lanes.mjs:609: "through the supervisor" |  |
| tests/acceptance/154-redraft/ | shared: the sandbox log stream | lanes.mjs site comment: runs the same way as #154, sandboxed plug-ins through the supervisor |  |
| tests/acceptance/154-oracle-redraft/ | shared: the sandbox log stream | lanes.mjs site comment: runs the same way as #154, sandboxed plug-ins through the supervisor |  |
| tests/acceptance/155/ | shared: the sandbox log stream | lanes.mjs:618: "through the supervisor" |  |
| tests/acceptance/155-oracle/ | shared: the sandbox log stream | lanes.mjs:618: "through the supervisor" |  |
| tests/acceptance/155-redraft-ac9/ | binary | tests/acceptance/155-redraft-ac9/presets.test.ts: spawnSync('cargo', ['build', '--locked', '--bin', 'deep-show'], { cwd: REPO,  | yes |
| tests/acceptance/1700/ | binary | tests/acceptance/1700/helpers.ts: spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024  | yes |
| tests/acceptance/1781/ | binary | tests/acceptance/1781/helpers.ts: spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024  | yes |
| tests/acceptance/409/ | shared: the GPU | lanes.mjs:633: "GPU" |  |
| tests/acceptance/409-oracle/ | shared: the GPU | lanes.mjs:633: "GPU" |  |
| tests/acceptance/1163/ | binary | tests/acceptance/1163/helpers.ts: `cargo build --locked --bin deep-show --no-default-f | yes |
| tests/acceptance/1164/ | binary | tests/acceptance/1164/helpers.ts: spawnSync('cargo', args, { cwd, encoding: 'utf8', maxBuffer: 64 * MIB, env: { | yes |
| tests/acceptance/1862/ | binary | tests/acceptance/322/helpers.ts: target/debug/deep-hook | no |
| tests/acceptance/1401/ | shared: the GPU | lanes.mjs:641: "GPU" |  |
| tests/acceptance/1729/ | shared: the GPU | lanes.mjs:643: "GPU" |  |
| tests/acceptance/1958/ | binary | tests/acceptance/1958/helpers.ts: `cargo build --locked --bin deep-show --no-default-f | yes |
| tests/acceptance/306-redraft-1958/ | binary | tests/acceptance/306/helpers.ts: spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024  | yes |
| tests/acceptance/157/ | shared: the GPU | lanes.mjs:652: "GPU" |  |
| tests/acceptance/157-oracle/ | shared: the GPU | lanes.mjs:652: "GPU" |  |
| tests/acceptance/518/ | shared: the GPU | lanes.mjs:657: "GPU" |  |
| tests/acceptance/518-redraft-ac10/ | timing | every file it holds is in the timed list |  |
| tests/acceptance/162/ | shared: the sandbox log stream | 162/README.md:68: starts a hub that runs tools through the supervisor |  |
| tests/acceptance/162-oracle/ | binary | tests/acceptance/501/helpers.ts: `cargo build --locked --bin deep-show --no-default-f | yes |
| tests/acceptance/162-redraft-ac6/ | binary | tests/acceptance/162-redraft-ac6/helpers.ts: `cargo build --locked --bin deep-show --no-default-f | yes |
| tests/acceptance/1183/ | binary | tests/acceptance/1183/helpers.ts: spawnSync('cargo', CARGO_ARGS, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * | yes |
| tests/acceptance/537/ | shared: the GPU | lanes.mjs:676: "GPU" |  |
| tests/acceptance/537-oracle/ | shared: the GPU | lanes.mjs:676: "GPU" |  |
| tests/acceptance/539/ | shared: the screen | lanes.mjs:679: "app's window" |  |
| tests/acceptance/539-oracle-redraft/ | binary | tests/acceptance/539/helpers.ts: `cargo build --locked --bin deep-show` (the default  | yes |
| tests/acceptance/538/ | binary | tests/acceptance/538/helpers.ts: `cargo build --locked --bin deep-show` with a build' | yes |
| tests/acceptance/538-oracle/ | binary | tests/acceptance/538/helpers.ts: `cargo build --locked --bin deep-show` with a build' | yes |
| tests/acceptance/538-redraft-ac8/ | timing | every file it holds is in the timed list |  |
| tests/acceptance/540/ | binary | tests/acceptance/540/helpers.ts: `cargo build --locked --bin deep-show` (the default  | yes |
| tests/acceptance/540-oracle/ | binary | tests/acceptance/540/helpers.ts: `cargo build --locked --bin deep-show` (the default  | yes |
| tests/acceptance/542/ | shared: the screen | lanes.mjs:694: "app's window" |  |
| tests/acceptance/903/ | shared: the screen | lanes.mjs:696: "app's window" |  |
| tests/acceptance/1920/ | binary | tests/acceptance/1920/helpers.ts: `cargo build --locked --bin deep-show --no-default-f | yes |
| tests/acceptance/1863/ | binary | tests/acceptance/322/helpers.ts: target/debug/deep-hook | no |
| tests/acceptance/2017/ | shared: the GPU | lanes.mjs:705: "Metal" |  |
| tests/acceptance/2017-redraft-ac2/ | shared: the GPU | tests/acceptance/2017-redraft-ac2/ac2-light-holds.test.ts calls requireMetal(), tests/acceptance/2017-redraft-ac2/helpers.ts's gate on macOS's Metal device |  |
| tests/acceptance/173/ | shared: the GPU | lanes.mjs:713: "GPU" |  |
| tests/acceptance/2070/ | binary | tests/acceptance/26/helpers.ts: hub run`) in a temporary home, its re (starts a hub, which runs deep-hook and deep-show from its checkout's target/: packages/hub/src/path | no |
| tests/acceptance/2070-gaps/ | binary | tests/acceptance/26/helpers.ts: hub run`) in a temporary home, its re (starts a hub, which runs deep-hook and deep-show from its checkout's target/: packages/hub/src/path | no |
| tests/acceptance/1725/ | binary | tests/acceptance/1732/helpers.ts: spawnSync('cargo', BUILD, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 | yes |
| tests/acceptance/55-redraft-ac13/ | binary | tests/acceptance/27/helpers.ts: run('cargo', args, { timeoutMs: 1_200_000 }).then((r) => { | yes |
| tests/acceptance/1606/ | binary | tests/acceptance/1606/helpers.ts: run('cargo', ['build', '--locked', '-q', ...args], { env: CARGO_ENV, ti | yes |
| tests/acceptance/1606-redraft-ac5-ac9/ | binary | tests/acceptance/1606-redraft-ac5-ac9/card.test.ts: run('cargo', ['test', '--locked', '-q', '-p', 'deep-app', '--test', 'ac | yes |
| tests/acceptance/2324/ | shared: Docker | lanes.mjs:730: "Docker" |  |
| tests/acceptance/2085/ | binary | tests/acceptance/2085/helpers.ts: spawnSync('cargo', args, { cwd: REPO, env, encoding: 'utf8', maxBuffer: 64 *  | yes |
| tests/acceptance/2362/ | binary | tests/acceptance/2362/kit.test.ts: `cargo build --locked --bin deep-show`), here | yes |
| tests/acceptance/509/ | shared: a fixed port | lanes.mjs:737: "fixed port 8720" |  |
| tests/acceptance/509-oracle/ | shared: a fixed port | lanes.mjs:737: "fixed port 8720" |  |
| tests/acceptance/2197/ | binary | tests/acceptance/26/helpers.ts: hub run`) in a temporary home, its re (starts a hub, which runs deep-hook and deep-show from its checkout's target/: packages/hub/src/path | no |
| tests/acceptance/2144/ | binary | scripts/affected.mjs: 'cargo test -p ')); | yes |
| tests/acceptance/1332/ | binary | tests/acceptance/29/h-d.ts: target/debug/deep-hook | no |
| tests/acceptance/2120/ | binary | tests/acceptance/1330/helpers.ts: target/debug/deep-hook | no |
| tests/acceptance/1347/ | binary | tests/acceptance/29/h-d.ts: target/debug/deep-hook | no |
| tests/acceptance/1347-redraft-1812/ | binary | tests/acceptance/29/h-d.ts: target/debug/deep-hook | no |
| tests/acceptance/1335/ | binary | tests/acceptance/29/h-d.ts: target/debug/deep-hook | no |
| tests/acceptance/1342/ | binary | tests/acceptance/29/h-d.ts: target/debug/deep-hook | no |
| tests/acceptance/1342-redraft-1812/ | binary | tests/acceptance/29/h-d.ts: target/debug/deep-hook | no |
| tests/acceptance/1345/ | binary | tests/acceptance/1345/helpers.ts: 'cargo build --locked -q'; | yes |
| tests/acceptance/1349/ | binary | tests/acceptance/1349/helpers.ts: runFor('cargo', args, { cwd: REPO, env: CARGO_ENV, timeoutMs: 90 * MIN }); | yes |
| tests/acceptance/525/ | binary | tests/acceptance/525/helpers.ts: `cargo build --locked --bin deep-show`; and #1920's  | yes |
| tests/acceptance/525-device/ | timing | every file it holds is in the timed list |  |
| tests/acceptance/204/ | binary | tests/acceptance/204/helpers.ts: `cargo build --locked --bin deep-show` once per file | yes |
| tests/acceptance/204-oracle/ | binary | tests/acceptance/204/helpers.ts: `cargo build --locked --bin deep-show` once per file | yes |
| tests/acceptance/204-redraft-ac7/ | binary | tests/acceptance/204-redraft-ac7/helpers.ts: `cargo build --locked --bin deep-show`, once per fil | yes |
| tests/acceptance/204-gaps/ | binary | tests/acceptance/204/helpers.ts: `cargo build --locked --bin deep-show` once per file | yes |
| tests/acceptance/450/ | shared: the GPU | lanes.mjs:781: "Metal" |  |
| tests/acceptance/451/ | shared: the GPU | lanes.mjs:783: "GPU" |  |
| tests/acceptance/239/ | shared: the GPU | lanes.mjs:788: "GPU" |  |
| tests/look-type.test.ts | binary | lanes.mjs site comment: its look-type regression builds deep-show | yes |
| tests/acceptance/507/ | binary | tests/acceptance/507/helpers.ts: spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024  | yes |
| tests/acceptance/507-oracle/ | binary | tests/acceptance/507/helpers.ts: spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024  | yes |
| tests/acceptance/169/ | shared: the GPU | lanes.mjs:795: "GPU" |  |
| tests/acceptance/226/ | shared: the GPU | lanes.mjs:799: "Metal" |  |
| tests/acceptance/2450/ | shared: the GPU | lanes.mjs:803: "Metal" |  |
| tests/acceptance/226-oracle-redraft/ | binary | tests/acceptance/226-oracle-redraft/helpers.ts: spawnSync('cargo', CARGO_ARGS, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * | yes |
| tests/acceptance/462/ | shared: the GPU | lanes.mjs:810: "Metal" |  |
| tests/look-regions-paths.test.ts | shared: the GPU | lanes.mjs:810: "Metal" |  |
| tests/acceptance/466/ | shared: the GPU | lanes.mjs:814: "Metal" |  |
| tests/acceptance/466-redraft-ac3/ | binary | 466-redraft-ac3/README.md:42-43: alone for its cargo build | yes |
| tests/acceptance/466-redraft-ac6/ | shared: the GPU | lanes.mjs:814: "Metal" |  |
| tests/acceptance/466-redraft-ac7/ | shared: the GPU | lanes.mjs:814: "Metal" |  |
| tests/acceptance/222/ | binary | tests/acceptance/222/helpers.ts: spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024  | yes |
| tests/acceptance/222-oracle/ | binary | tests/acceptance/222-oracle/helpers.ts: `cargo build --locked --bin deep-show --no-default-f | yes |
| tests/acceptance/222-redraft-ac7/ | timing | every file it holds is in the timed list |  |
| tests/acceptance/223/ | binary | tests/acceptance/223/helpers.ts: spawnSync('cargo', args, { cwd: REPO, env, encoding: 'utf8', maxBuffer: 64 *  | yes |
| tests/acceptance/223-oracle/ | binary | tests/acceptance/223/helpers.ts: spawnSync('cargo', args, { cwd: REPO, env, encoding: 'utf8', maxBuffer: 64 *  | yes |
| tests/acceptance/225/ | shared: Docker | lanes.mjs:827: "Docker" |  |
| tests/acceptance/225-oracle/ | binary | tests/acceptance/225/helpers.ts: spawnSync('cargo', args, { cwd: REPO, env, encoding: 'utf8', maxBuffer: 64 *  | yes |
| tests/acceptance/225-oracle-redraft-ac7/ | binary | tests/acceptance/225-oracle-redraft-ac7/helpers.ts: spawnSync('cargo', CARGO_ARGS, { cwd: REPO, env, encoding: 'utf8', maxBuffer: | yes |
| tests/acceptance/225-redraft-ac5/ | shared: Docker | 225-redraft-ac5/ac5-lorenz-two-machines.test.ts:50 calls buildLinux(), helpers.ts:294-345 |  |
| tests/acceptance/172/ | shared: the GPU | lanes.mjs:838: "WebGPU" |  |
| tests/acceptance/172-oracle/ | shared: the GPU | lanes.mjs:838: "WebGPU" |  |
| tests/acceptance/549/ | shared: the GPU | 549/ac1-no-net.test.ts:54 calls Chrome.open(); 549/helpers.ts:872: headless with WebGPU on |  |
| tests/acceptance/549-oracle/ | binary | tests/acceptance/549/helpers.ts: spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 256 * MIB, | yes |
| tests/acceptance/549-redraft-ac2/ | binary | 549-redraft-ac2/README.md:52: headless Chrome is not used; 549/helpers.ts builds with cargo | yes |
| tests/acceptance/550/ | binary | tests/acceptance/550/helpers.ts: spawnSync('cargo', ['build', '--locked', '--bin', 'deep-show', '--no-default- | yes |
| tests/acceptance/550-oracle/ | binary | tests/acceptance/550/helpers.ts: spawnSync('cargo', ['build', '--locked', '--bin', 'deep-show', '--no-default- | yes |
| tests/acceptance/551/ | binary | tests/acceptance/549/helpers.ts: spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 256 * MIB, | yes |
| tests/acceptance/551-oracle/ | binary | tests/acceptance/549/helpers.ts: spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 256 * MIB, | yes |
| tests/acceptance/280/ | timing | 280/ac1-windows.test.ts:54, ac2-web-window.test.ts:57: 280/helpers.ts:69-73 gates on the reference Mac and its load |  |
| tests/acceptance/280-redraft-ac4/ | binary | tests/acceptance/549/helpers.ts: spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 256 * MIB, | yes |
| tests/acceptance/277/ | timing | tests/acceptance/277/ac4-budgets.test.ts: referenceMacProblem |  |
| tests/acceptance/297/ | binary | tests/acceptance/297/helpers.ts: `cargo build --locked --bin deep-show` once a file,  | yes |
| tests/acceptance/297-oracle/ | binary | tests/acceptance/297/helpers.ts: `cargo build --locked --bin deep-show` once a file,  | yes |
| tests/acceptance/172-redraft-ac2/ | binary | tests/acceptance/169/helpers.ts: `cargo build --locked --bin deep-show --no-default-f | yes |
| tests/acceptance/1041/ | shared: the GPU | lanes.mjs:875: "WebGPU" |  |
| tests/acceptance/1045/ | shared: the GPU | lanes.mjs:877: "WebGPU" |  |
| tests/acceptance/2856/ | shared: the GPU | lanes.mjs:880: "WebGPU" |  |
| tests/acceptance/1490/ | shared: the GPU | lanes.mjs:882: "WebGPU" |  |
| tests/acceptance/1969/ | binary | tests/acceptance/1969/helpers.ts: spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024  | yes |
| tests/acceptance/142/ | binary | tests/acceptance/142/helpers.ts: spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024  | yes |
| tests/acceptance/142-redraft-ac9/ | binary | tests/acceptance/142-redraft-ac9/helpers.ts: spawnSync('cargo', SHOW_ARGS, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 *  | yes |
| tests/acceptance/142-redraft-ac10/ | binary | tests/acceptance/142-redraft-ac10/helpers.ts: spawnSync('cargo', SHOW_ARGS, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 *  | yes |
| tests/acceptance/548/ | shared: the screen | lanes.mjs:893: "app's window" |  |
| tests/acceptance/224/ | shared: the GPU | lanes.mjs:897: "Metal" |  |
| tests/acceptance/224-oracle/ | binary | 224-oracle/README.md:62: runs on the CPU, on any machine; the oracle lane builds deep-show (224/helpers.ts cargo) | yes |
| tests/acceptance/1940/ | binary | tests/acceptance/1940/helpers.ts: `cargo build --locked --bin deep-show --no-default-f | yes |
| tests/acceptance/1968/ | binary | tests/acceptance/535/helpers.ts: `cargo build --locked --bin deep-show`, with the bui | yes |
| tests/acceptance/1968-oracle/ | binary | tests/acceptance/535/helpers.ts: `cargo build --locked --bin deep-show`, with the bui | yes |
| tests/acceptance/2497/ | shared: the checkout's source files | lanes.mjs site comment: a file builds deep-show with a source file changed for that build and restored after it, "so nothing else may build in the checkout while it runs" |  |
| tests/acceptance/2073/ | binary | tests/acceptance/2073/helpers.ts: hub run`) in a temporary (starts a hub, which runs deep-hook and deep-show from its checkout's target/: packages/hub/src/paths.ts, #2817 | no |
| tests/acceptance/26-redraft-2073/ | binary | tests/acceptance/26/helpers.ts: hub run`) in a temporary home, its re (starts a hub, which runs deep-hook and deep-show from its checkout's target/: packages/hub/src/path | no |
| tests/acceptance/19-redraft-2073/ | binary | tests/acceptance/19/setup/helpers.ts: run('cargo', ['build', '--locked', '-q', '-p', 'deep-hook'], { cwd: REP | yes |
| tests/acceptance/823-redraft-2073/ | binary | tests/acceptance/823/helpers.ts: hub run`) in a temporary home, its re (starts a hub, which runs deep-hook and deep-show from its checkout's target/: packages/hub/src/pat | no |
| tests/acceptance/27-redraft-2073/ | binary | tests/acceptance/27/helpers.ts: run('cargo', args, { timeoutMs: 1_200_000 }).then((r) => { | yes |
| tests/acceptance/1942-redraft-2073/ | shared: the Lima VMs | 1942-redraft-2073/survives.test.ts:52 calls openWorld('deep-fedora'), 1942/helpers.ts:389 |  |
| tests/acceptance/16-redraft-1865/ | binary | tests/acceptance/16-redraft-1865/helpers.ts: run('cargo', ['build', '--locked', '-q', '-p', 'deep-hook', ...extra],  | yes |
| tests/acceptance/468/ | shared: the GPU | lanes.mjs:929: "Metal" |  |
| tests/acceptance/468-redraft-ac3/ | shared: the GPU | lanes.mjs:929: "Metal" |  |
| tests/acceptance/506/ | shared: the GPU | lanes.mjs:935: "Metal" |  |
| tests/acceptance/506-redraft-ac5/ | shared: the GPU | lanes.mjs:935: "Metal" |  |
| tests/acceptance/508/ | shared: the GPU | lanes.mjs:939: "Metal" |  |
| tests/acceptance/213/ | binary | tests/acceptance/2009/helpers.ts: `cargo build --locked --bin deep-physics`, once per  | yes |
| tests/acceptance/213-oracle/ | binary | tests/acceptance/2009/helpers.ts: `cargo build --locked --bin deep-physics`, once per  | yes |
| tests/acceptance/213-redraft-ac3/ | binary | tests/acceptance/2009/helpers.ts: `cargo build --locked --bin deep-physics`, once per  | yes |
| tests/acceptance/463/ | shared: the GPU | lanes.mjs:951: "Metal" |  |
| tests/acceptance/233/ | binary | tests/acceptance/233/helpers.ts: spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024  | yes |
| tests/acceptance/233-oracle/ | binary | tests/acceptance/233-oracle/helpers.ts: spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024  | yes |
| tests/acceptance/184/ | shared: the sandbox log stream | tests/acceptance/184/ac01-clean-maze.test.ts calls openHub, which opens the supervisor (tests/acceptance/184/helpers.ts) |  |
| tests/acceptance/184-redraft-ac7-2/ | shared: the sandbox log stream | tests/acceptance/184-redraft-ac7-2/ac7-bots-refused.test.ts calls openHub, which opens the supervisor (tests/acceptance/184/helpers.ts) |  |
| tests/acceptance/555/ | shared: the sandbox log stream | tests/acceptance/555/ac01-crawler.test.ts calls openHub, which opens the supervisor (tests/acceptance/555/helpers.ts) |  |
| tests/acceptance/1048/ | shared: the sandbox log stream | tests/acceptance/1048/ac01-rules-legal.test.ts calls openHub, which opens the supervisor (tests/acceptance/1048/helpers.ts) |  |
| tests/acceptance/1040/ | shared: the GPU | lanes.mjs:970: "WebGPU" |  |
| tests/acceptance/556/ | shared: the sandbox log stream | tests/acceptance/556/ac01-floors.test.ts calls openHub, which opens the supervisor (tests/acceptance/556/helpers.ts) |  |
| tests/acceptance/556-redraft-ac5/ | timing | every file it holds is in the timed list |  |
| tests/acceptance/1808/ | shared: the screen | lanes.mjs:979: "opens the real app" |  |
| tests/acceptance/458/pairs/ | shared: the GPU | lanes.mjs:982: "GPU" |  |
| tests/acceptance/458/relations/ | shared: the GPU | lanes.mjs:982: "GPU" |  |
| tests/acceptance/458/views/ | shared: the GPU | lanes.mjs:982: "GPU" |  |
| tests/acceptance/192/dungeon/ | shared: Docker | lanes.mjs:984: "Docker" |  |
| tests/acceptance/860/ | shared: the GPU | 860/ac05-determinism-web.test.ts:11: plays in headless Chrome with WebGPU |  |
| tests/acceptance/2516/ | shared: the GPU | tests/acceptance/2516/redraft-ac4/cube.test.ts runs deep-gpu and never names the noop backend, so it draws on the machine's GPU |  |
| tests/acceptance/457/ | shared: the GPU | lanes.mjs:993: "Metal" |  |
| tests/acceptance/1636/ | shared: Docker | lanes.mjs:998: "linux/amd64 container" |  |
| tests/acceptance/210/ | shared: the GPU | 210/ac6-web-export.test.ts:7: ready in headless Chrome on WebGPU |  |
| tests/acceptance/2031/ | shared: the GPU | lanes.mjs:1005: "Metal" |  |
| tests/acceptance/1561/ | shared: the GPU | lanes.mjs:1008: "GPU" |  |
| tests/acceptance/2032/ | shared: the GPU | lanes.mjs:1011: "Metal" |  |
| tests/acceptance/2032-redraft-ac8/ | timing | its one file is in the timed list |  |
| tests/acceptance/182/ | shared: Docker | lanes.mjs:1017: "linux/amd64 container" |  |
| tests/acceptance/182-oracle/controllers-py-rapier.test.ts | binary | tests/acceptance/182-oracle/helpers.ts: spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * MIB,  | yes |
| tests/acceptance/182-oracle-redraft-climb/ | binary | tests/acceptance/182-oracle-redraft-climb/helpers.ts: spawnSync('cargo', BUILD_ARGS, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * | yes |
| tests/acceptance/2240/ | binary | tests/acceptance/191/helpers.ts: spawnSync('cargo', args, { cwd, encoding: 'utf8', maxBuffer: 64 * MIB, env: { | yes |
| tests/acceptance/2309/ | binary | tests/acceptance/191/helpers.ts: spawnSync('cargo', args, { cwd, encoding: 'utf8', maxBuffer: 64 * MIB, env: { | yes |
| tests/acceptance/2243/ | binary | tests/acceptance/182/helpers.ts: spawnSync('cargo', args, { cwd, encoding: 'utf8', maxBuffer: 64 * MIB, env: { | yes |
| tests/acceptance/2241/ | binary | tests/acceptance/191/helpers.ts: spawnSync('cargo', args, { cwd, encoding: 'utf8', maxBuffer: 64 * MIB, env: { | yes |
| tests/acceptance/2009-redraft-2241/ | binary | tests/acceptance/2009/helpers.ts: `cargo build --locked --bin deep-physics`, once per  | yes |
| tests/acceptance/2239/ | binary | tests/acceptance/191/helpers.ts: spawnSync('cargo', args, { cwd, encoding: 'utf8', maxBuffer: 64 * MIB, env: { | yes |
| tests/acceptance/2239-redraft-ac4/ | binary | tests/acceptance/191/helpers.ts: spawnSync('cargo', args, { cwd, encoding: 'utf8', maxBuffer: 64 * MIB, env: { | yes |
| tests/acceptance/2248/ | binary | tests/acceptance/191/helpers.ts: spawnSync('cargo', args, { cwd, encoding: 'utf8', maxBuffer: 64 * MIB, env: { | yes |
| tests/acceptance/2098/ | binary | tests/acceptance/191/helpers.ts: spawnSync('cargo', args, { cwd, encoding: 'utf8', maxBuffer: 64 * MIB, env: { | yes |
| tests/acceptance/2098-redraft-ac2/ | binary | tests/acceptance/191/helpers.ts: spawnSync('cargo', args, { cwd, encoding: 'utf8', maxBuffer: 64 * MIB, env: { | yes |
| tests/acceptance/2307/ | binary | tests/acceptance/191/helpers.ts: spawnSync('cargo', args, { cwd, encoding: 'utf8', maxBuffer: 64 * MIB, env: { | yes |
| tests/acceptance/2310/ | shared: Docker | 2310/ac7-seek-golden-merge-base.test.ts:110 calls onLane('linux/amd64'), 2012/helpers.ts:100-151 |  |
| tests/acceptance/2308/ | binary | tests/acceptance/191/helpers.ts: spawnSync('cargo', args, { cwd, encoding: 'utf8', maxBuffer: 64 * MIB, env: { | yes |
| tests/acceptance/191-redraft-2308/ | binary | tests/acceptance/191/helpers.ts: spawnSync('cargo', args, { cwd, encoding: 'utf8', maxBuffer: 64 * MIB, env: { | yes |
| tests/acceptance/2371/ | binary | tests/acceptance/2371/helpers.ts: `cargo build --locked --bin deep-physics`). | yes |
| tests/acceptance/1931/ | binary | tests/acceptance/191/helpers.ts: spawnSync('cargo', args, { cwd, encoding: 'utf8', maxBuffer: 64 * MIB, env: { | yes |
| tests/acceptance/191-redraft-1931/ | binary | tests/acceptance/191/helpers.ts: spawnSync('cargo', args, { cwd, encoding: 'utf8', maxBuffer: 64 * MIB, env: { | yes |
| tests/acceptance/2742/ | shared: the GPU | tests/acceptance/2742/ac1-composited-gpu-time.test.ts calls requireMetal(), tests/acceptance/2742/helpers.ts's gate on macOS's Metal device |  |
| tests/acceptance/192/voxel/ | binary | tests/acceptance/192/voxel/helpers.ts: `cargo build --locked --bin deep-show --no-default-f | yes |
| tests/acceptance/192/packs/ | binary | tests/acceptance/192/packs/helpers.ts: spawnSync('cargo', ['--version'], { encoding: 'utf8' }); | yes |
| tests/acceptance/192/packs-redraft-ac12/ | binary | tests/acceptance/192/packs/helpers.ts: spawnSync('cargo', ['--version'], { encoding: 'utf8' }); | yes |
| tests/acceptance/416/layouts/ | binary | tests/acceptance/416/layouts/helpers.ts: spawnSync('cargo', ['build', '--locked', '--manifest-path', join(WAT_DIR, 'Ca | yes |
| tests/acceptance/1017/budgets.test.ts | timing | every file it holds is in the timed list |  |
| tests/acceptance/1097/budgets.test.ts | timing | every file it holds is in the timed list |  |
| tests/acceptance/111/budgets.test.ts | timing | every file it holds is in the timed list |  |
| tests/acceptance/304/budgets.test.ts | timing | every file it holds is in the timed list |  |
| tests/acceptance/308/budgets.test.ts | timing | every file it holds is in the timed list |  |
| tests/acceptance/31/budgets.test.ts | timing | every file it holds is in the timed list |  |
| tests/acceptance/40/budgets.test.ts | timing | every file it holds is in the timed list |  |
| tests/acceptance/45/budgets.test.ts | timing | every file it holds is in the timed list |  |
| tests/acceptance/572/budgets.test.ts | timing | every file it holds is in the timed list |  |
| tests/acceptance/63/budgets.test.ts | timing | every file it holds is in the timed list |  |
| tests/acceptance/69/budgets.test.ts | timing | every file it holds is in the timed list |  |
| tests/acceptance/103-redraft-1830/ | timing | every file it holds is in the timed list |  |
| tests/acceptance/365-redraft-1830/ | timing | every file it holds is in the timed list |  |
| tests/acceptance/262-redraft-1830/ | timing | every file it holds is in the timed list |  |
| tests/acceptance/761-redraft-1830/ | timing | every file it holds is in the timed list |  |
| tests/acceptance/1098-redraft-1830/ | timing | every file it holds is in the timed list |  |
| tests/acceptance/417-redraft-1830/ | timing | every file it holds is in the timed list |  |
| tests/acceptance/149-redraft-1830/ | timing | every file it holds is in the timed list |  |
| tests/acceptance/124-redraft-1830/ | timing | every file it holds is in the timed list |  |
| tests/acceptance/1427-redraft-1830/ | timing | every file it holds is in the timed list |  |
| tests/acceptance/311-redraft-1830/ | timing | every file it holds is in the timed list |  |
| tests/acceptance/1018-redraft-1830/ | timing | every file it holds is in the timed list |  |
| tests/acceptance/166-redraft-1830/ | timing | every file it holds is in the timed list |  |
| tests/acceptance/268-redraft-1830/ | timing | every file it holds is in the timed list |  |
| tests/acceptance/465-redraft-1830/ | timing | every file it holds is in the timed list |  |
| tests/acceptance/968-redraft-1830/ | timing | every file it holds is in the timed list |  |
| tests/acceptance/1830/ac2-timing.test.ts | timing | every file it holds is in the timed list |  |
| tests/acceptance/1381/ | shared: the GPU | lanes.mjs:1110: "Metal" |  |
| tests/acceptance/971/ | shared: the GPU | lanes.mjs:1114: "Metal" |  |
| tests/acceptance/1992/ | shared: the GPU | lanes.mjs:1119: "Metal" |  |
| tests/acceptance/1992-redraft-ac5/ | shared: the GPU | lanes.mjs:1119: "Metal" |  |
| tests/acceptance/1831/ | shared: the GPU | lanes.mjs:1124: "GPU" |  |
| tests/acceptance/2652/ | binary | tests/acceptance/875/helpers.ts: spawnSync('cargo', ['build', '-p', 'deep-hook'], { cwd: REPO, stdio: 'inherit | yes |
| tests/acceptance/1928/ | binary | tests/acceptance/1928/helpers.ts: spawnSync('cargo', CARGO, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 | yes |
| tests/acceptance/2650/cycles.test.ts | binary | tests/acceptance/2650/helpers.ts: packages/cli/dist/main.js'); (starts a hub, which runs deep-hook and deep-show from its checkout's target/: packages/hub/src/paths.ts, # | no |
| tests/acceptance/2650/planted-answers.test.ts | binary | tests/acceptance/2650/helpers.ts: packages/cli/dist/main.js'); (starts a hub, which runs deep-hook and deep-show from its checkout's target/: packages/hub/src/paths.ts, # | no |
| tests/acceptance/2650/planted-results.test.ts | binary | tests/acceptance/2650/helpers.ts: packages/cli/dist/main.js'); (starts a hub, which runs deep-hook and deep-show from its checkout's target/: packages/hub/src/paths.ts, # | no |
| tests/acceptance/2650/planted-jobs.test.ts | binary | tests/acceptance/2650/helpers.ts: packages/cli/dist/main.js'); (starts a hub, which runs deep-hook and deep-show from its checkout's target/: packages/hub/src/paths.ts, # | no |
| tests/acceptance/2650/planted-names.test.ts | binary | tests/acceptance/2650/helpers.ts: packages/cli/dist/main.js'); (starts a hub, which runs deep-hook and deep-show from its checkout's target/: packages/hub/src/paths.ts, # | no |
| tests/acceptance/2650/retries.test.ts | shared: the sandbox log stream | tests/acceptance/2650/retries.test.ts calls openWorld, which opens the supervisor (tests/acceptance/2650/host.ts) |  |
| tests/acceptance/2650/jobs.test.ts | shared: the sandbox log stream | 2650/jobs.test.ts: each job is the stand-in agent, through the supervisor |  |
| tests/acceptance/2650/replay.test.ts | shared: the sandbox log stream | tests/acceptance/2650/replay.test.ts calls openWorld, which opens the supervisor (tests/acceptance/2650/host.ts) |  |
| tests/acceptance/1498/ | binary | tests/acceptance/1498/helpers.ts: execFile('cargo', args, { cwd: REPO, env, maxBuffer: 64 * 1024 * 1024 }, (er | yes |
| tests/acceptance/1812/ | binary | tests/acceptance/1812/helpers.ts: `cargo`, `claude` or `codex` on that PATH. `<tmp>/confirm` holds `c | yes |
| tests/acceptance/67-redraft-1812/ | binary | tests/acceptance/67/hub.ts: target/debug/deep-hook | no |
| tests/acceptance/66-redraft-1812/ | shared: the sandbox log stream | tests/acceptance/66-redraft-1812/fix.test.ts calls linearWorld, which opens the supervisor (tests/acceptance/66/worlds.ts) |  |
| tests/acceptance/1495/app-download.test.ts | binary | lanes.mjs site comment: "builds the real app download once per commit (release-pack's full build, the app's runtime folder)" | no |
| tests/acceptance/1592/ | binary | tests/acceptance/1592/helpers.ts: run('cargo', ['build', '--locked', '-q', ...args], { env: CARGO_ENV, ti | yes |
| tests/acceptance/1431/ | shared: the screen | lanes.mjs:1162: "app's window" |  |
| tests/acceptance/1801/ | timing | tests/acceptance/1801/city.test.ts: judgeLimit |  |
| tests/acceptance/2403/ | shared: the screen | lanes.mjs:1169: "opens the real app" |  |
| tests/acceptance/1411/ | binary | tests/acceptance/1411/real-build.test.ts: `cargo build --workspace` of a 64-crate workspace | yes |
| tests/acceptance/1512/ | binary | tests/acceptance/316/helpers.ts: run('cargo', args, { timeoutMs: 900_000 }).then((r) => { | yes |
| tests/acceptance/1509/ | binary | tests/acceptance/1509/helpers.ts: target/debug/deep-hook | no |
| tests/acceptance/1929/ | binary | tests/acceptance/1929/helpers.ts: spawnSync('cargo', CARGO, { cwd: REPO, encoding: 'utf8', maxBuffer: 256 * 102 | yes |
| tests/acceptance/2760/ | shared: the GPU | lanes.mjs:1187: "GPU" |  |
| tests/acceptance/2760-redraft-ac8/ | timing | every file it holds is in the timed list |  |
| tests/acceptance/1826/ | binary | tests/acceptance/1826/helpers.ts: spawnSync('cargo', args, { cwd: REPO, env: CARGO_ENV, encoding: 'utf8', maxBu | yes |
| tests/acceptance/732/ | shared: the GPU | lanes.mjs:1198: "GPU" |  |
| tests/acceptance/1484/ | shared: the GPU | 1484/helpers.ts:143-145, atlas.test.ts:31: GPUI's offscreen Metal renderer |  |
| tests/acceptance/1415/ | binary | tests/acceptance/1415/helpers.ts: spawnSync('cargo', args, { cwd: REPO, env: cargoEnv(), encoding: 'utf8', maxB | yes |
| tests/acceptance/806-redraft-ac3/ | shared: the GPU | 806-redraft-ac3/ac3-unbound.test.ts:111 calls openFigures({ app: true }), 806/helpers.ts:91,382 |  |
| tests/acceptance/1430/ | binary | tests/acceptance/224/helpers.ts: spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 256 * MIB, | yes |
| tests/acceptance/1430-redraft-ac2/ | binary | tests/acceptance/224/helpers.ts: spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 256 * MIB, | yes |
| tests/acceptance/2402/ | shared: the sandbox log stream | 2402/budget.test.ts:75 calls openSupervisor(); the file is not in timed |  |
| tests/acceptance/2456/ | binary | tests/acceptance/2456/helpers.ts: spawnSync('cargo', CARGO_ARGS, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * | yes |
| tests/write-reveal-frames.test.ts | binary | tests/acceptance/1969/helpers.ts: spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024  | yes |
| tests/acceptance/2776/seal.test.ts | binary | tests/acceptance/2776/helpers.ts: spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024  | yes |
| tests/acceptance/2776/export.test.ts | binary | tests/acceptance/2776/helpers.ts: spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024  | yes |
| tests/acceptance/2776/listing.test.ts | binary | tests/acceptance/2776/helpers.ts: spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024  | yes |
| tests/acceptance/1215/ | shared: the GPU | 1215/ac8-taste.test.ts:46 calls #1479's needsMac |  |
| tests/acceptance/2457/ | binary | tests/acceptance/2457/helpers.ts: `cargo build --locked --bin deep-physics`), built be | yes |
| tests/acceptance/2645/ | no reason | not established: for the owner |  |
| tests/acceptance/2500/ | binary | tests/acceptance/467/helpers.ts: spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024  | yes |
| tests/acceptance/1489/ | shared: the GPU | 1489/helpers.ts:472: the replica draws with GPUI's offscreen Metal renderer; seek.test.ts:13 |  |
| tests/acceptance/2777/ | timing | tests/acceptance/2777/preflight.test.ts: environmentProblem( |  |
| tests/acceptance/211/ | binary | tests/acceptance/211/helpers.ts: spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * MIB,  | yes |
| tests/acceptance/981/ | binary | tests/acceptance/190/helpers.ts: spawnSync('cargo', args, { cwd, encoding: 'utf8', maxBuffer: 64 * MIB, env: { | yes |
| tests/acceptance/2898/ | shared: the sandbox log stream | 2898/README.md:25: sandboxed through the supervisor |  |
| tests/acceptance/189/saves/ | binary | tests/acceptance/189/saves/helpers.ts: spawnSync('cargo', args, { cwd, encoding: 'utf8', maxBuffer: 64 * MIB, env: { | yes |
| tests/acceptance/189-oracle/ | binary | tests/acceptance/189/saves/helpers.ts: spawnSync('cargo', args, { cwd, encoding: 'utf8', maxBuffer: 64 * MIB, env: { | yes |
| tests/acceptance/189/carry/ | shared: the GPU | 189/carry/ac09-web-player.test.ts:1: in headless Chrome with WebGPU |  |
| tests/acceptance/189/lab-redraft/ | binary | tests/acceptance/189/lab-redraft/helpers.ts: `cargo build` for `b` in the checkout, the binary co | yes |
| tests/acceptance/851/ | shared: the sandbox log stream | tests/acceptance/851/ac01-unlock.test.ts calls hubOnce, which opens the supervisor (tests/acceptance/851/helpers.ts) |  |
| tests/acceptance/276/record/ | binary | tests/acceptance/276/record/helpers.ts: spawnSync('cargo', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 | yes |
| tests/acceptance/276/match/ | binary | tests/acceptance/276/match/helpers.ts: spawnSync('cargo', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 | yes |
| tests/acceptance/276/web/ | shared: the GPU | 276/web/helpers.ts:247: ready, on WebGPU, used by ac07-web-player.test.ts |  |
| tests/acceptance/2227/ | no reason | not established: for the owner |  |
| tests/acceptance/2109/ | binary | lanes.mjs site comment: "runs #83's AC11 goldens, which start real hubs"; a hub runs deep-hook from its checkout's target/ (#2817) | no |
| tests/acceptance/1518/ | shared: a fixed port | lanes.mjs:1309: "fixed port 8720" |  |
| tests/acceptance/1518-redraft-ac1/ | shared: a fixed port | 1518-redraft-ac1/heard.test.ts:60 calls withPlugin(w, SPEECH); 509/helpers.ts:425 gives SPEECH port 8720 |  |
| tests/acceptance/953/ | binary | tests/acceptance/190/helpers.ts: spawnSync('cargo', args, { cwd, encoding: 'utf8', maxBuffer: 64 * MIB, env: { | yes |
| tests/acceptance/953-oracle/ | binary | tests/acceptance/190/helpers.ts: spawnSync('cargo', args, { cwd, encoding: 'utf8', maxBuffer: 64 * MIB, env: { | yes |
| tests/acceptance/2738/ | shared: the GPU | lanes.mjs:1321: "GPU" |  |
| tests/acceptance/265/ | shared: the GPU | lanes.mjs:1325: "GPU" |  |
| tests/acceptance/1250/ | binary | tests/acceptance/501/helpers.ts: `cargo build --locked --bin deep-show --no-default-f | yes |
| tests/acceptance/1576/ | binary | tests/acceptance/16/helpers.ts: run('cargo', ['build', '--locked', '-q', '-p', 'deep-hook', ...extra],  | yes |
| tests/acceptance/3016/ | shared: the GPU | lanes.mjs:1338: "Metal" |  |
| tests/acceptance/2661/ | binary | 2661/ac6-canvas-record.test.mjs: cargo build -p deep-app and reads target/debug/deep-app; its window files run by hand | yes |
| tests/acceptance/980/ | binary | tests/acceptance/190/helpers.ts: spawnSync('cargo', args, { cwd, encoding: 'utf8', maxBuffer: 64 * MIB, env: { | yes |
| tests/acceptance/1861/ | binary | lanes.mjs site comment: its claim starts a hub of its own; proof-label.test.ts starts hub run | yes |
| tests/acceptance/552/ | shared: the GPU | lanes.mjs site comment: ac1, ac2, ac6 and ac7 draw on the GPU |  |
| tests/acceptance/553/ | timing | lanes.mjs site comment: ac4 reads net.budget over five runs, INCONCLUSIVE off a reference Mac or under load; the file is not in timed |  |
| tests/acceptance/298/ | shared: the GPU | lanes.mjs site comment: draws on the Metal GPU; its files call requireGpu() |  |
| tests/acceptance/2897/ | binary | lanes.mjs site comment: starts a hub and the MCP servers, as #26 does; helpers: cargo build -p deep-hook | yes |
| tests/acceptance/2897-redraft-ac6/ | binary | lanes.mjs site comment: starts a hub and the MCP servers, as #26 does | yes |
