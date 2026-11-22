// #1847 AC2: a regex literal holding a quote, a division and a template literal, none of them a module name.
const quoted = /"/g;
const half = 10 / 2 / 1;
export const label = `plain imports ${half}`.replace(quoted, "");
