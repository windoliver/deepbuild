// #1425 AC7: a table whose cells are drawn by script, called per visible cell on every frame (DataTable's
// render_cell), the rule the panel runtime keeps: a list takes its rows as data.
import { View, div, DataTable, DataTableState } from "@deepbuild/panel";

export default class ScriptedTable extends View {
  init() {
    this.state = DataTableState.new(["symbol", "price"]);
    this.rows = [
      { symbol: "AAPL", price: 227.95 },
      { symbol: "MSFT", price: 432.16 },
    ];
  }

  render() {
    return div()
      .size_full()
      .child(
        DataTable.new(
          this.state,
          () => this.rows,
          (row, column) => div().child(String(row[column])),
        ),
      );
  }
}
