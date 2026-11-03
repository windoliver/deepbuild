# Dispute: `#418.186ac2bb look@1 names the shipped implementation … every kit part, and the shipped look passes that kit on its own fixtures` (kit.test.ts)

The original test reads "its conformance kit is every part of the canvas kit (#138)" as every part any interface in
the plan lists, behavior parts aside, and then requires the kit to report exactly that set of parts on the look
module. Two things in that reading can't hold without breaking the proof rules:

1. **`sandbox` is not a part of #138's canvas kit.** It is sandbox@1's own part (#238: "its fixtures on this host's
   engine, against the reference's results"), listed only in sandbox@1's kit. The test counts it because
   sandbox@1's `behavior` reads `"none"`. #138's scope names thirteen parts; #185 made each canvas interface's kit
   those parts plus `bit`. On the work, look@1's kit lists all fourteen:

   ```
   AssertionError: look@1's kit is every part of the canvas kit (fixtures, clean_rebuild, patch_fuzz, read_set,
   order, schedule, repair_loop, carried_state, late_entry, time_order, contribution, catalog, migration, bit,
   sandbox): expected [ 'sandbox' ] to deeply equal []
    ❯ kit.test.ts:41:97
   ```

2. **The kit runs a part on a module only when the module has something that part tests.** The look module has no
   carried state, no late entry, no contribution order to permute, no migration and (for the shipped reference) no
   other implementation to compare with `bit`, so those parts have no case. Reporting them on look would mean a part
   that ran nothing reads PASS, which AGENTS.md invariant 2 forbids ("Nothing missing or unrun passes"). The
   original's next assertion (`new Set(look.parts.map(p => p.part))` equal to look@1's kit) needs exactly that.

The blind redraft (`kit-shipped-redraft.test.ts`, commit `fd807db8`, written from the issue, the design and the base
without the work, the diff or this note) reads the item as: look@1 lists every part of #138's kit and no behavior
part; the kit runs only parts that kit lists, each running every case it declares with at least one, none FAIL or
INVALID; and the look module's own fixtures reach the finish (tone_map naming filmic, agx and neutral; ao; deband;
grade; bloom). It fails at the base (`KIT-REDRAFT-BASE.txt`) because the look module's only fixture sets none of the
finish fields, and it passes on the work, where the look module gains the `look.finish@1` swatches and its `finish`
fixture. The planted side of the same item (kit.test.ts's second test) passes on the work unchanged.

Under the design's Dogfooding rule, the swap is the owner's call. Both drafts stay in the tree until then.
