// Rust source with every comment, string, byte string, raw string and char literal blanked to
// spaces (newlines kept, so line and column numbers hold). A line-based strip would let a string
// holding `//` hide the rest of its line, so this walks the tokens that can contain `//` or `"`.
export function stripRust(source) {
  let out = '';
  let i = 0;
  const blank = (end) => {
    for (; i < end && i < source.length; i++) out += source[i] === '\n' ? '\n' : ' ';
  };
  while (i < source.length) {
    const rest = source.slice(i, i + 3);
    if (rest.startsWith('//')) {
      const end = source.indexOf('\n', i);
      blank(end < 0 ? source.length : end);
    } else if (rest.startsWith('/*')) {
      let depth = 0;
      let j = i;
      do {
        if (source.startsWith('/*', j)) { depth++; j += 2; }
        else if (source.startsWith('*/', j)) { depth--; j += 2; }
        else j++;
      } while (depth > 0 && j < source.length);
      blank(j);
    } else if (/^b?r#*"/.test(source.slice(i, i + 8)) && (source[i] === 'r' || source[i] === 'b')) {
      const open = /^b?r(#*)"/.exec(source.slice(i, i + 8));
      const close = `"${open[1]}`;
      const end = source.indexOf(close, i + open[0].length);
      blank(end < 0 ? source.length : end + close.length);
    } else if (source[i] === '"' || (source[i] === 'b' && source[i + 1] === '"')) {
      let j = i + (source[i] === 'b' ? 2 : 1);
      while (j < source.length && source[j] !== '"') j += source[j] === '\\' ? 2 : 1;
      blank(j + 1);
    } else if (source[i] === "'" && /^'(\\.[^']*|[^'\\])'/.test(source.slice(i, i + 12))) {
      // A char literal; a lifetime (`'a`) has no closing quote and falls through.
      blank(i + /^'(\\.[^']*|[^'\\])'/.exec(source.slice(i, i + 12))[0].length);
    } else {
      out += source[i];
      i++;
    }
  }
  return out;
}
