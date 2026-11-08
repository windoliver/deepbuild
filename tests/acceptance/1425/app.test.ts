// The suite's Rust half (app/panels.rs), built and run once by cargo, each of its tests read back as a test here so the
// trace lane sees its criterion's ID: AC1's slot views, AC2's toolkit refusals and planted loader, AC3's off-catalog
// refusal and catalog render, AC7's per-frame refusal and planted pack check. AC5's timing test runs in budgets.test.ts.
import { beforeAll, expect, test } from 'vitest';
import { AC1, AC2, AC3, AC7, BUILD_MS, rustSuite } from './helpers.ts';

/** Every test app/panels.rs holds for these criteria, by its exact name. */
const NAMES = [
  `${AC1} the view each panel registers in a slot draws the merge base's tree, byte for byte`,
  `${AC2} a panel importing "gpui-kit" is refused at pack check, naming the module and line`,
  `${AC2} a panel importing "gpui-kit" is refused at load, naming the module and line`,
  `${AC2} planted: a host that skips the load check loads the gpui-kit panel, and the load judge fails it naming the panel`,
  `${AC3} a panel using a name off the catalog is refused at pack check and at load, naming it and the closest catalog name`,
  `${AC3} every catalog name renders in a replica in light and dark`,
  `${AC7} a panel whose list runs script per frame is refused at pack check, naming the component`,
  `${AC7} planted: a pack check that skips the per-frame check passes the panel, and the judge fails it naming the panel`,
];

let suite: ReturnType<typeof rustSuite>;
beforeAll(() => {
  suite = rustSuite([AC1, AC2, AC3, AC7].map((id) => id.slice(6)));
}, BUILD_MS);

for (const name of NAMES) {
  test(name, () => {
    const result = suite.results.get(name);
    expect(result, `BLOCKED: app/panels.rs didn't report this test\n${suite.output}`).toBeDefined();
    expect(result!.ok, result!.message).toBe(true);
  });
}
