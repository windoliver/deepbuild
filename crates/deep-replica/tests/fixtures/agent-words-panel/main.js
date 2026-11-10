// Issue #1459: a panel's own words, drawn as plain text inside its slot, which the tree keeps marked as an agent's.
import { View, v_flex, div } from "@deepbuild/panel";

export default class AgentWords extends View {
  render(cx) {
    return v_flex().id("agent-words").size_full().p(12).child(div().child("Deploy finished"));
  }
}
