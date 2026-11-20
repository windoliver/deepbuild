// AC1's preload (README): imported first by ac1-verdict-patterns.test.ts, before any module under test, it puts a
// counting wrapper in place of the global `RegExp`. Every construction through it, `new RegExp(...)` or `RegExp(...)`,
// is handed to the active counter (if any) with its pattern's source, then made by the real constructor, so the
// regular expressions code builds are the ones it always built. Literals (`/.../`) never call the constructor, so
// they are not counted, and nothing compiled from one is. `instanceof RegExp` and RegExp's statics read through the
// wrapper to the real constructor.
type Seen = (source: string) => void;
let active: Seen | undefined;
const Native = RegExp;
const sourceOf = (pattern: unknown): string => (pattern instanceof Native ? pattern.source : String(pattern));
const Counting: RegExpConstructor = new Proxy(Native, {
  construct(target, args: unknown[], newTarget): object {
    active?.(sourceOf(args[0]));
    return Reflect.construct(target, args, newTarget === Counting ? target : newTarget) as object;
  },
  apply(target, self, args: unknown[]): unknown {
    active?.(sourceOf(args[0]));
    return Reflect.apply(target, self, args) as unknown;
  },
});
(globalThis as { RegExp: RegExpConstructor }).RegExp = Counting;

/** Counts the constructions made while `seen` is set; the handler must build no RegExp itself. */
export function countRegExps(seen: Seen | undefined): void {
  active = seen;
}
