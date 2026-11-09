// #1470's fixture panel: one menu, "Actions", with three rows. Each row's on_pick adds one to its own counter, drawn
// as "ran <id> <n>", and to the total, "ran total <n>", so a pick is a line of text in the replica's snapshot and "once"
// is a count of 1. The rest of the panel is empty space, so a release "off every row" has somewhere to land. This
// file imports only @deepbuild/panel.
import { View, div, v_flex, Menu } from "@deepbuild/panel";

const ROWS = [
  { id: "alpha", label: "Alpha row" },
  { id: "bravo", label: "Bravo row" },
  { id: "charlie", label: "Charlie row" },
];

export default class MenuFixture extends View {
  init() {
    this.ran = { alpha: 0, bravo: 0, charlie: 0 };
  }

  render() {
    const total = Object.values(this.ran).reduce((a, b) => a + b, 0);
    return v_flex()
      .size_full()
      .p(12)
      .gap(8)
      .child(
        new Menu("actions", {
          label: "Actions",
          rows: ROWS.map((row) => ({
            id: row.id,
            label: row.label,
            on_pick: (cx) => {
              this.ran[row.id] += 1;
              cx.notify();
            },
          })),
        }),
      )
      .child(div().child(`ran total ${total}`))
      .child(div().child(`ran alpha ${this.ran.alpha}`))
      .child(div().child(`ran bravo ${this.ran.bravo}`))
      .child(div().child(`ran charlie ${this.ran.charlie}`));
  }
}
