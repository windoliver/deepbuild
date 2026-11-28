import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AC, ADDRESS, answers, claudeCodeSession, cleanup, control, doctor, ENDPOINT, eventsOf, holdPort, itemText, PORT, requirePortFree, running,
  startHub, stopHub, TELEMETRY, telemetryItem, world,
} from './helpers.ts';

const LIMIT = 900_000;
afterEach(cleanup, 180_000);

describe('#1852 the hub starts the OTLP receiver, and the doctor says when nothing listens where Claude Code exports', () => {
  it(`${AC[1]}`, { timeout: LIMIT }, async () => {
    await requirePortFree();
    const w = world(TELEMETRY);
    const hub = await startHub(w);
    const session = randomUUID();
    const sent = await claudeCodeSession(w, session);
    const events = (await eventsOf(hub, ['tool.span', 'request.cost'])).filter((e) => e.session === session);
    const kinds = events.map((e) => e.kind);
    expect(
      { 'tool.span': kinds.includes('tool.span'), 'request.cost': kinds.includes('request.cost') },
      `the installed hub's record holds tool.span and request.cost for session ${session}, exported by Claude Code to ${ENDPOINT} (port ${PORT}); kinds seen: [${kinds.join(', ')}]; the exports: ${sent.report}`,
    ).toEqual({ 'tool.span': true, 'request.cost': true });
    await stopHub(hub);
    expect(await answers(), `once the hub has stopped, nothing answers on ${ADDRESS}`).toBe(false);
  });

  it(`${AC[2]}`, { timeout: LIMIT }, async () => {
    await requirePortFree();
    const w = world(TELEMETRY);
    const alone = await doctor(w);
    const item = telemetryItem(alone);
    expect(item, `deep doctor --json lists the otlp.telemetry item: ${alone.ran.stdout.slice(0, 2000)}`).toBeDefined();
    expect(
      { level: item!.level, namesAddress: `${item!.evidence} ${item!.fix}`.includes(ADDRESS) },
      `with Claude Code exporting to ${ENDPOINT} and nothing listening on ${ADDRESS}, the item fails naming the address; it read ${itemText(item)}`,
    ).toEqual({ level: 'fail', namesAddress: true });
    expect(alone.ran.code, 'deep doctor exits non-zero with a failing item').not.toBe(0);
    const hub = await startHub(w);
    const served = telemetryItem(await doctor(w));
    expect({ level: served?.level, code: served?.code }, `with the installed hub running its receiver on ${ADDRESS}, the same settings read healthy; it read ${itemText(served)}`)
      .toEqual({ level: 'ok', code: 'healthy' });
    await stopHub(hub);
  });

  it(`${AC[3]}`, { timeout: LIMIT }, async () => {
    await requirePortFree();
    await holdPort();
    const w = world(TELEMETRY);
    const hub = await startHub(w);
    const health = await control(hub, 'hub.health', {});
    expect({ running: running(hub), answered: typeof health === 'object' && health !== null }, `the installed hub starts and answers with ${ADDRESS} held by another process: ${hub.stderr()}`)
      .toEqual({ running: true, answered: true });
    const d = await doctor(w);
    const item = telemetryItem(d);
    expect(item, `deep doctor --json lists the otlp.telemetry item: ${d.ran.stdout.slice(0, 2000)}`).toBeDefined();
    expect(
      { flagged: ['warn', 'fail'].includes(item!.level), namesPort: new RegExp(`\\b${PORT}\\b`).test(`${item!.evidence} ${item!.fix}`) },
      `with ${ADDRESS} held by another process, the hub runs without its receiver and the item says so, naming port ${PORT}; it read ${itemText(item)}`,
    ).toEqual({ flagged: true, namesPort: true });
    expect(running(hub), `the hub still runs after deep doctor: ${hub.stderr()}`).toBe(true);
    await stopHub(hub);
  });
});
