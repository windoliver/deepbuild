// #1847 AC1: a planted panel. This file is clean; its own file reach.js reaches the toolkit in a spelling the merge
// base's check doesn't read.
import { View, div } from "@deepbuild/panel";
import { reach } from "./reach.js";

export default class ReachesByTemplate extends View {
  render() {
    return div().size_full().p(8).child(typeof reach);
  }
}
