// AC8: `channel` is a minor of user.ask@2: the newest minor's `from` lists it, still marked extensible with `unknown`
// among its members, and an event from a channel validates there. A reader at the earlier minor (user.ask@2 as the base
// commit d303e2b6 published it, kept here byte for byte in fixtures/user.ask@2.earlier.json) reads it through the hub's
// own reader at a use's minor (extension-host's `servedAt`, What a minor may change): `from` is `unknown`, as that
// schema's closure says, and the value it reads is valid at its minor.
import { readFileSync } from 'node:fs';
import { afterAll, describe, it } from 'vitest';
import { getSchema, registry, validate, type Schema } from '../../../packages/contracts/src/index.ts';
import { servedAt } from '../../../packages/extension-host/src/compose.ts';
import { AC8, cleanup, must, needRecordings, type Line } from './helpers.ts';

afterAll(cleanup, 60_000);

const EARLIER = JSON.parse(readFileSync(new URL('./fixtures/user.ask@2.earlier.json', import.meta.url), 'utf8')) as Schema;
const fromOf = (schema: Line): Line => schema.properties?.data?.properties?.from ?? {};

describe(`${AC8} a reader at the earlier minor of user.ask@2 reads channel as unknown, as the schema's closure says`, () => {
  it(`${AC8} user.ask@2's newest minor lists channel in an extensible from; a reader at the earlier minor reads it as unknown`, (ctx) => {
    if (!needRecordings(ctx)) return;
    must(!(fromOf(EARLIER).enum as string[]).includes('channel') && fromOf(EARLIER)['x-closure']?.mark === 'extensible', `BLOCKED: ${AC8} the kept earlier minor must be the base's user.ask@2, whose extensible from lists no channel`);
    const newest = getSchema('user.ask@2') as Line;
    const from = fromOf(newest);
    must(Array.isArray(from.enum) && from.enum.includes('channel'), `${AC8} user.ask@2's newest minor must list channel among from's members: ${JSON.stringify(from.enum)}`);
    must(from['x-closure']?.mark === 'extensible' && from.enum.includes('unknown'), `${AC8} user.ask@2's from must stay extensible, with unknown among its members, so an earlier reader can read a new member: ${JSON.stringify({ enum: from.enum, closure: from['x-closure'] })}`);
    const event = { v: 2, id: '01KB3405CHANNE1EVENT000000', kind: 'user.ask', writer: 'hook', actor: 'you', scope: 'you', ts: 1795800000000, data: { msg: 1, text: '<channel source="ci-relay">build 812 failed</channel>', tasks: [], from: 'channel' } };
    const now = validate('user.ask@2', event);
    must(now.ok, `${AC8} a user.ask from: channel must be valid at user.ask@2's newest minor: ${JSON.stringify(now)}`);
    const read = servedAt(event, EARLIER) as Line;
    must(read?.data?.from === 'unknown', `${AC8} a reader at the earlier minor of user.ask@2 must read from: channel as unknown, as its closure says; it reads ${JSON.stringify(read?.data?.from)}`);
    must(read.data.text === event.data.text && read.data.msg === event.data.msg, `${AC8} the earlier reader keeps the fields its minor lists: ${JSON.stringify(read)}`);
    const then = registry([{ name: 'user.ask@2 (earlier minor)', schema: EARLIER }]).validate('user.ask@2 (earlier minor)', read);
    must(then.ok, `${AC8} what the earlier reader reads must be valid at its own minor: ${JSON.stringify(then)}`);
  });
});
