// Issue #124 criterion 5's fixture panel for the snapshot budget (tests/acceptance/124/README.md, Fixtures): 2,000
// buttons, each its own accessibility node named "Node <i>", in 40 rows of 50, 4 points square with 1 point between,
// so all of them fit on screen in the 260-point slot at once.
import { View } from "gpui-kit";
import { v_flex, h_flex, Button } from "gpui-base";

const ROWS = 40;
const COLUMNS = 50;

export default class ManyNodes extends View {
  render(cx) {
    const rows = [];
    for (let r = 0; r < ROWS; r++) {
      const cells = [];
      for (let c = 0; c < COLUMNS; c++) {
        const i = r * COLUMNS + c;
        cells.push(Button.new(`n${i}`).accessibility_label(`Node ${i}`).w(4).h(4).bg(cx.theme().colors.border));
      }
      rows.push(h_flex().gap(1).children(cells));
    }
    return v_flex().id("many-nodes").size_full().p(2).gap(1).bg(cx.theme().colors.background).children(rows);
  }
}
