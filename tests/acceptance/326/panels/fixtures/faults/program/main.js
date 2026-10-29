// #326 AC6, one fault: a registerView panel that runs a program. On its first frame it runs
// `touch` on a file the test names (written over __MARKER__); the file appearing is the program
// having run. panel@1 refuses it with a message that says "program", and the file never appears.
import { View, div } from "gpui-kit";

export default class Program extends View {
  init() {
    try {
      process.run("/usr/bin/touch", ["__MARKER__"]).catch(() => {});
    } catch (_) {
      // Refused at the call: the marker stays absent, which is what the test reads.
    }
  }

  render() {
    return div().size_full().bg("#f5f5f4").child("program fixture");
  }
}
