// By-hand end-to-end run of #22 (parts #318, #319): a real `deep hub run` in a temporary home, `deep setup`, sessions
// of the Claude Code stand-in whose hooks run the real deep-hook and whose deep_ask goes through the real `deep mcp`.
// Prints `deep inbox` at each step and the record's ask events. Batches every 2 minutes, cap 2 a day, taste deadline
// 7 minutes with 1 minute's notice, so the whole cycle fits in about ten minutes of real time.
import { writeFileSync } from 'node:fs';
import { it } from 'vitest';

const H = process.env.E2E_HELPERS!;
const OUT = process.env.E2E_OUT!;
const out: string[] = [];
const log = (s: string) => { out.push(s); writeFileSync(OUT, `${out.join('\n')}\n`); };
const hhmmss = (ms: number) => new Date(ms).toISOString().slice(11, 19);

it('e2e', async () => {
  const h = await import(H);
  const { home } = h.makeHome();
  const repo = h.makeRepo(home).dir;
  h.editConfig(home, (c: any) => { c.asks = { batch: { every: '2m', cap: 2 }, deadline: { taste: '7m' }, notice: { taste: '1m' } }; });
  const hub = await h.startHub(home);
  const set = await h.setup(home);
  log(`World: home ${home}, repo ${repo}. deep setup: exit ${set.code}.`);
  log(`Your asks settings after setup (config.json): ${JSON.stringify(JSON.parse((await import('node:fs')).readFileSync(`${h.rootOf(home)}/config.json`, 'utf8')).asks)}`);
  const inbox = async (title: string) => {
    const r = await h.deep(home, ['inbox']);
    log(`\n$ deep inbox    # ${title}, at ${hhmmss(Date.now())}Z\n${r.stdout.trimEnd() || '(empty)'}${r.code ? `\n(exit ${r.code}) ${r.stderr}` : ''}`);
  };
  const statuses = async () => Object.fromEntries((await h.inboxRows(hub)).map((r: any) => [r.ask, `${r.status}${r.outcome ? `/${r.outcome}` : ''}`]));
  const taste = (who: string, n: number) => ({
    question: `${who}: which header colour for screen ${n}?`, recommended: 'green', subject: { point: null, screen: `checkout-${who}-${n}`, element: null },
    options: [{ id: 'blue', label: 'Blue header' }, { id: 'green', label: 'Green header' }],
  });
  // A session of its own Claude Code stand-in (or `o.s`, another call in one session) calls deep_ask with kind taste.
  const ask = async (who: string, n: number, o: any = {}) => {
    const q = taste(who, n);
    const s = o.s ?? h.newSession(home, repo);
    const claude = o.claude ?? h.Claude.start(home);
    if (!o.s) {
      await claude.hook('SessionStart', h.payload(s, 'SessionStart'));
      h.typedPrompt(s, 'Pick header colours for the checkout screens, then stop.');
      await claude.hook('UserPromptSubmit', h.payload(s, 'UserPromptSubmit', { prompt: 'Pick header colours for the checkout screens, then stop.' }));
    }
    const args = { kind: 'taste', question: q.question, options: q.options, recommended: q.recommended, steps: null, where: null, why: null, check: null, subject: q.subject };
    let replied: any;
    const replying = claude.tool(s, 'deep_ask', args, 600_000).then((r: any) => (replied = r));
    const created = await h.waitFor(async () => replied?.error ? replied : (await h.allEvents(hub)).find((e: any) => e.kind === 'ask.created' && e.data?.question === q.question), 60_000, `deep_ask ${q.question}`);
    if (!created.kind) throw Error(`deep_ask failed: ${JSON.stringify(created).slice(0, 800)}`);
    return { s, claude, q, handle: `ask:${created.id}`, finish: () => replying };
  };
  // Start just after a batch time, so the next one is about 2 minutes away.
  const EVERY = 120_000;
  while (Date.now() % EVERY > 3000) await h.sleep(500);
  const nextBatch = Math.ceil(Date.now() / EVERY) * EVERY;
  log(`\n1. Three taste calls from sessions A, B and C at ${hhmmss(Date.now())}Z, raised by each session's deep_ask (kind taste). The next batch is at ${hhmmss(nextBatch)}Z.`);
  const [a, b, c] = [await ask('A', 1), await ask('B', 1), await ask('C', 1)];
  for (const x of [a, b, c]) void x.finish().catch(() => undefined);
  log(`   A ${a.handle}, B ${b.handle}, C ${c.handle}`);
  await inbox('all three wait for the batch');
  log(`   statuses: ${JSON.stringify(await statuses())}`);

  while (Date.now() < nextBatch + 4000) await h.sleep(500);
  log(`\n2. The ${hhmmss(nextBatch)}Z batch shows two (the day's cap is 2); the third waits.`);
  await inbox('after the batch');
  log(`   statuses: ${JSON.stringify(await statuses())}`);

  const first = (await h.inboxRows(hub)).find((r: any) => r.status === 'shown' && [a.handle, b.handle].includes(r.ask));
  const shownAsk = [a, b].find((x) => x.handle === first?.ask) ?? a;
  log(`\n3. You answer ${shownAsk.handle} with blue from your terminal (the OS confirmation is the test stand-in, DEEP_HUB_TEST_CONFIRM).`);
  const ans = await h.deep(home, ['inbox', 'answer', shownAsk.handle, 'blue']);
  log(`$ deep inbox answer ${shownAsk.handle} blue\n${(ans.stdout + ans.stderr).trimEnd()}  (exit ${ans.code})`);
  const first_ = await shownAsk.finish().catch((e: Error) => ({ error: e.message }));
  log(`   The agent's deep_ask had returned, before you answered: ${JSON.stringify(first_).slice(0, 500)}`);
  const waited = await shownAsk.claude.tool(shownAsk.s, 'deep_wait', { ask: shownAsk.handle }, 120_000).catch((e: Error) => ({ error: e.message }));
  log(`   The agent's deep_wait returns your answer: ${JSON.stringify(waited).slice(0, 500)}`);

  log(`\n4. Session D asks six taste calls; past five open, the sixth folds into one "this session keeps asking" exception, which waits for a batch like any ask.`);
  const d1 = await ask('D', 1);
  void d1.finish().catch(() => undefined);
  const ds = [d1];
  for (let n = 2; n <= 6; n++) {
    const x = await ask('D', n, { s: d1.s, claude: d1.claude });
    void x.finish().catch(() => undefined);
    ds.push(x);
  }
  log(`   D's asks: ${ds.map((x) => x.handle).join(', ')}`);
  await h.sleep(1500);
  await inbox('D\'s six asks, the sixth folded');
  const exc = (await h.inboxRows(hub)).find((r: any) => r.kind === 'exception' && r.status !== 'closed');
  log(`   the exception: ${JSON.stringify(exc).slice(0, 600)}`);
  const deadline = (await h.allEvents(hub)).find((e: any) => e.kind === 'ask.created' && `ask:${e.id}` === c.handle)?.data?.deadline;
  const dl = h.msOf(deadline);
  log(`\n5. C's deadline is ${hhmmss(dl)}Z. With the cap reached it waits until the last batch before its deadline, where it must show at once, and only then takes its default.`);
  const until = dl + 70_000;
  let last = '';
  while (Date.now() < until) {
    const s = (await statuses())[c.handle];
    if (s !== last) { log(`   ${hhmmss(Date.now())}Z C is ${s}`); last = s; }
    if (s === 'closed/defaulted') break;
    await h.sleep(1000);
  }
  await inbox('C defaulted at its deadline, announced and undoable');
  const u = await h.deep(home, ['inbox', 'undo', c.handle]);
  log(`\n6. You undo C's default.\n$ deep inbox undo ${c.handle}\n${(u.stdout + u.stderr).trimEnd()}  (exit ${u.code})`);
  await inbox('C open again');

  // The exception shows like any ask: the day's cap is spent, so at the last batch before the earliest deadline it holds.
  if (exc) {
    let st = '';
    while (st !== 'shown/unanswered' && !st.startsWith('closed')) { await h.sleep(1000); st = (await statuses())[exc.ask]; }
    log(`\n7. ${hhmmss(Date.now())}Z the exception ${exc.ask} is ${st}: it showed at the last batch before the earliest deadline it holds.`);
    await inbox('the exception in Needs you, its six asks folded in it');
    const t = await h.deep(home, ['inbox', 'answer', exc.ask, 'together']);
    log(`\n8. You answer the exception in bulk.\n$ deep inbox answer ${exc.ask} together\n${(t.stdout + t.stderr).trimEnd()}  (exit ${t.code})`);
    await h.sleep(1000);
    const after = await statuses();
    log(`   D's six after: ${JSON.stringify(Object.fromEntries(ds.map((x) => [x.handle, after[x.handle]])))}; the exception: ${after[exc.ask]}`);
    await inbox('after the bulk answer');
  }
  log('\n9. The record: every ask event, in order.');
  for (const e of (await h.allEvents(hub)).filter((e: any) => /^(ask|decision)\./.test(e.kind))) {
    const d = e.data ?? {};
    const brief = e.kind === 'ask.created' ? { kind: d.kind, question: d.question, deadline: d.deadline && hhmmss(h.msOf(d.deadline)), default: d.default, folded: d.folded }
      : e.kind === 'ask.batched' ? { batch: d.batch, asks: (d.asks ?? []).map((x: any) => x.ask) } : d;
    log(`  ${hhmmss(h.msOf(e.ts))}Z ${e.kind} ${e.subject ?? `ask:${e.id}`} ${JSON.stringify(brief).slice(0, 300)}`);
  }
  await h.stopHub(hub);
  await h.cleanup();
}, 1_200_000);
