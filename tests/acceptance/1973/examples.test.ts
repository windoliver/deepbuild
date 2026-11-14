// AC3: "Every kind `deep_kinds list` shows as available has an example hash that `read` serves; on the merge base the
// ten kinds above fail, each named."
//
// asserts: deep_kinds `{op: "list", registry: "kind@1"}` on `deep-show run`, paged by its `next` cursor to the last
// page, lists the ten kinds the parent issue names (image@1, marks@1, axis@1, scale@1, mask@1, group@1, star@1,
// frame@1, matte@1, overlay.frame@1) as available, so none passes by leaving the listing; every entry it shows with
// `available: true` lists an `example` hash, and `{op: "read", example: <hash>}` serves it: a reply with no error
// whose `text` hashes (SHA-256) to the hash and names the kind (helpers.ts, exampleFailures; each failure names the
// kind). On the merge base the ten kinds fail, each named (BASE-FAILURE.txt).

import { describe, expect, it } from 'vitest';
import { TEN, exampleFailures, listedKinds, none, readCall, run, useFullBuild, type JsonObject } from './helpers.ts';

const build = useFullBuild();

describe('AC3 every kind deep_kinds lists as available has an example read serves', () => {
  it('AC3 every kind deep_kinds list shows as available has an example hash that read serves', () => {
    const bin = build();
    const listed = listedKinds(bin);
    const available = listed.filter((k) => k.available).map((k) => k.name);
    expect(available, 'deep_kinds list shows the ten kinds the issue names as available').toEqual(expect.arrayContaining(TEN));
    const hashes = [...new Set(listed.filter((k) => k.available && typeof k.example === 'string' && k.example !== '').map((k) => k.example as string))];
    const replies = new Map<string, JsonObject>();
    if (hashes.length) run(bin, hashes.map(readCall)).forEach((r, i) => replies.set(hashes[i]!, r));
    none(exampleFailures(listed, replies), `the examples of the ${available.length} kinds deep_kinds list shows as available`);
  }, 3_600_000);
});
