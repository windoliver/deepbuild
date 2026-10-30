// Path globs, as checks declare their inputs: `**` matches any number of segments, `*` anything within one.
const cache = new Map<string, RegExp>();
function compile(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === '*' && glob[i + 1] === '*') {
      i++;
      if (glob[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*';
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}
export function matches(glob: string, path: string): boolean {
  let re = cache.get(glob);
  if (!re) cache.set(glob, (re = compile(glob)));
  return re.test(path);
}
