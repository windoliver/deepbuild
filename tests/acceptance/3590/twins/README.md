# Twins for the 3590 tests

One twin, kept in the line form (`tests/acceptance/1832/README.md`, The line form): `fixed-wait/lines.json` edits
`scripts/bays.mjs` and holds no whole file. `../twins.json` names it for its criterion.

| Criterion | Twin | The one rule it breaks | Test it fails, and how |
|---|---|---|---|
| `#3590.e0489985` (criterion 2) | `fixed-wait` | `claimPair` asks `acquire('bay-pair', { wait: 0.05 })`, a fixed 0.05-minute wait, and on no grant returns `{ blocked: 'INCONCLUSIVE no grant: no bay pair came within 0.05 min' }`. Who gets a pair (the refusal before it) and the pair it returns are unchanged | `claim.test.mjs`, the `#3590.e0489985` test: "claimPair returned { blocked: "INCONCLUSIVE no grant: no bay pair came within 0.05 min" } behind a line whose grants changed hands every 2 s" |
| `#3590.da82cdc0` (criterion 4) | `asks-first` | `claimPair` asks `acquire('bay-pair', { wait: 0.02 })` before it looks at `refusal(root)`, and gives back whatever it got, so a root that gets no bay still puts a bay-pair request in the table and, with every pair held, logs its timeout before it is refused. The refusal it returns and the claim of a root that gets a pair are unchanged | `refusal.test.mjs`, the `#3590.da82cdc0` test: "the log holds bay-pair entries of the refused claim's process (pid N)" |

**Where its lines go.** Its `find` lines are the merge base's (`5f95d82bb`), the three that open `claimPair` and refuse
a root that gets no bay:

```js
export function claimPair(root, print) {
  const refused = refusal(root);
  if (refused) return { refused };
```

Its `wrong` lines keep those three and add, in a block of its own, a whole claim on the fixed wait that returns before
whatever wait the change itself asks for. So the twin doesn't depend on how the change words its own wait: it applies
to the change as long as those three lines stay as they are, as "who gets a pair is unchanged" leaves them. If the
change rewrites them, the before lane reads the twin as stale and it needs a blind redraft against the change's file;
nobody else edits it.

It also fails `#3590.14b452d8` (its granted entry carries `wait: 0.05`) and `#3590.e8f50f42` (its line reads `no bay pair
came within 0.05 min`), but those two fail on the merge base already, which is their proof of failing first.
Criterion 4's test (`#3590.da82cdc0`) passes on the twin, as it should: the twin refuses as the base does.

`asks-first/lines.json` finds the same three opening lines of `claimPair` as `fixed-wait`, and its `wrong` lines put the
ask, in a block of its own, between the first of them and the refusal; the other two follow it unchanged. It goes
stale on the same terms as `fixed-wait`.
