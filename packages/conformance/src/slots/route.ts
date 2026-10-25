// The route@1 kit (#349): an inbound route's handler, `"<METHOD> <path>"` → handle(request) → { status, body }.
// Registering a route opens nothing (the host serves it only once you turned the package on and chose it); what
// the kit holds is the handler: it answers with a status and a text body, it refuses a method other than its
// route's with 405 instead of serving it, and a GET changes nothing, so asking twice reads the same answer. Each
// case is a request relative to the fill's own route, so any route passes, not only the reference's.
import type { JsonValue } from '@deepbuild/contracts';
import type { Random } from '../generator.js';
import { fail } from '../slot-types.js';
import type { Fixture, PlantedFill, SlotCase, SlotFill, SlotKitImpl, SlotRule } from '../slot-types.js';
import { object, word } from './shared.js';

export const ROUTE = 'route@1';

export interface RouteRequest { method: string; path: string; headers: Record<string, string>; body: string }
export interface RouteReply { status: number; body: string }
export interface RouteFill extends SlotFill {
  slot: 'route@1';
  route: string;
  handle(request: RouteRequest): RouteReply;
}
/** A case's request, relative to the fill's route: the other methods to try (the first that isn't the route's), and a header that varies. */
interface Input { otherMethods: string[]; header?: string }

const RULES = {
  shape: { id: 'answers-status-and-body', rule: 'A reply carries an integer status from 100 to 599 and a text body, and the route\'s own method is answered with a success (2xx).', message: 'answered without a status and a body' },
  method: { id: 'declared-method-only', rule: 'A request by a method other than the route\'s is refused with 405, never served.', message: 'served a method its route doesn\'t declare' },
  read: { id: 'get-changes-nothing', rule: 'A GET changes nothing: two GETs of one path read the same body.', message: 'changed state on a GET' },
};
const rules: SlotRule[] = Object.values(RULES).map(({ id, rule }) => ({ id, rule }));
const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'];

type Fault = 'none' | 'no-status' | 'any-method' | 'counts';
function reference(route = 'GET /health', fault: Fault = 'none'): RouteFill {
  const [method] = route.split(' ');
  let calls = 0;
  return {
    slot: ROUTE, revision: 1, route,
    handle(request) {
      calls++;
      if (fault !== 'any-method' && request.method !== method) return { status: 405, body: `${request.method} isn't ${route}'s method` };
      const body = fault === 'counts' ? `ok ${calls}` : 'ok';
      return fault === 'no-status' ? ({ body } as unknown as RouteReply) : { status: 200, body };
    },
  };
}

const plant = (name: string, breaks: keyof typeof RULES, codes: string[], fill: RouteFill): PlantedFill<RouteFill> => ({ name, message: RULES[breaks].message, codes, breaks: RULES[breaks].id, fill });
const plantedFills = (): PlantedFill<RouteFill>[] => [
  plant('no-status', 'shape', ['reply_unshaped'], reference('GET /health', 'no-status')),
  plant('answers-any-method', 'method', ['method_unchecked'], reference('GET /health', 'any-method')),
  plant('get-changes-state', 'read', ['get_changed_state'], reference('GET /health', 'counts')),
];

const toCase = (id: string, part: 'fixed' | 'seeded', input: Input): SlotCase => ({ id, part, input: input as unknown as JsonValue, expected: null });
// In the order the preflight's check meets them, so each planted fill is refused at its first case.
const fixtures: Fixture[] = [
  toCase('own-method-then-post', 'fixed', { otherMethods: ['POST', 'GET'] }),
  toCase('own-method-then-delete', 'fixed', { otherMethods: ['DELETE', 'GET'] }),
].map(({ id, input, expected }) => ({ id, input, expected }));

/** Three requests from the draw: the other method and the headers vary. */
const generate = (random: Random): SlotCase[] => [0, 1, 2].map((i) =>
  toCase(`seeded-${i + 1}`, 'seeded', { otherMethods: [METHODS[random.int(0, METHODS.length - 1)]!, 'POST', 'GET'], header: word(random, 8) }));

function hold(answer: unknown): RouteReply {
  const o = object('the reply', answer);
  if (!Number.isInteger(o.status) || (o.status as number) < 100 || (o.status as number) > 599 || typeof o.body !== 'string') {
    throw fail(RULES.shape.message, ['reply_unshaped'], `the reply is ${JSON.stringify(o)}`);
  }
  return o as unknown as RouteReply;
}

function* judge(fill: RouteFill, c: SlotCase): Generator<() => unknown, void, unknown> {
  const { otherMethods, header } = c.input as unknown as Input;
  const [method, path] = typeof fill.route === 'string' ? fill.route.split(' ') : [];
  if (!method || !path || !METHODS.includes(method)) throw fail(RULES.method.message, ['method_unchecked'], `the fill's route ${JSON.stringify(fill.route)} isn't "<METHOD> <path>"`);
  const otherMethod = otherMethods.find((m) => m !== method) ?? 'POST';
  const request = (m: string): RouteRequest => ({ method: m, path, headers: header ? { 'x-deep-case': header } : {}, body: '' });
  const first = hold(yield () => fill.handle(request(method)));
  if (first.status < 200 || first.status > 299) throw fail(RULES.shape.message, ['reply_unshaped'], `${fill.route} answered ${first.status} to its own method, not a success`);
  const other = hold(yield () => fill.handle(request(otherMethod)));
  if (other.status !== 405) throw fail(RULES.method.message, ['method_unchecked'], `${otherMethod} ${path} was answered ${other.status}, not 405`);
  if (method !== 'GET') return;
  const again = hold(yield () => fill.handle(request(method)));
  if (again.body !== first.body) throw fail(RULES.read.message, ['get_changed_state'], `two GETs of ${path} read ${JSON.stringify(first.body)} then ${JSON.stringify(again.body)}`);
}

export const routeKit = (): SlotKitImpl<RouteFill> => ({
  slot: ROUTE, fills: 'many', revision: 1, rules, fixtures, planted: plantedFills(),
  clean: () => [reference()], generate, judge,
});
