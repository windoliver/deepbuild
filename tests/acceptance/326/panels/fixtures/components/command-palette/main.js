// #326 AC7: gpui-shell's registered Command, the command palette, from a panel in the sidebar
// slot. It is drawn 1200 points wide with a list allowed 2000 points tall, so it runs past its
// 260-point panel into the question card's rect unless the host keeps it off.
import { View } from "gpui-kit";
import { v_flex } from "gpui-base";
import { Command, CommandGroup, CommandItem, CommandState } from "gpui-component";

export default class CommandPaletteFixture extends View {
  init() {
    this.state = CommandState();
  }

  render() {
    let group = new CommandGroup("Fixture commands");
    for (let index = 0; index < 60; index += 1) {
      group = group.child(
        new CommandItem(`${index + 1}: a command whose row runs well past the panel it was opened in`).action(
          `fixture-${index + 1}`,
        ),
      );
    }
    return v_flex()
      .size_full()
      .bg("#f5f5f4")
      .child(new Command(this.state).placeholder("Type a command").max_height(2000).w(1200).child(group));
  }
}
