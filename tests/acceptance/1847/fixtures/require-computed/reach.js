// #1847 AC1 planted: a require whose module name is computed, on line 5.
// Nothing calls it while the panel loads, so a loader that doesn't read this spelling loads the panel.
export function reach() {
  const name = ["gpui", "kit"].join("-");
  return require(name);
}
