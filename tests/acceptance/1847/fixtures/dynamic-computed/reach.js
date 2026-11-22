// #1847 AC1 planted: a dynamic import whose module name is computed, on line 6.
// Nothing calls it while the panel loads, so a loader that doesn't read this spelling loads the panel.
const toolkit = "gpui-" + "kit";

export async function reach() {
  return import(toolkit);
}
