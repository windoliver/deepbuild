// Reads forms.mjs's rows: a redacted table, one line a form, and the counts the report's scoreboard states.
//   node sum.mjs <rows.jsonl> <table.txt>
import { readFileSync, writeFileSync } from 'node:fs';
const [file, table] = process.argv.slice(2);
const rows = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.args);
const plain = (r, s) => s.replaceAll(r.home, '~').replaceAll(r.tmp, '<tmp>').replace(/\/Users\/[^/\s'"]+\/[^\s'":]*?\/(?=packages\/|tests\/|scripts\/)/g, '<checkout>/').replace(/\/Users\/[^/\s'"]+/g, '<home>');
const flags = (r) => [r.stack && 'STACK', r.undef && 'undefined', r.nan && 'NaN', r.object && '[object]', r.errno && 'errno', r.pathTwice && 'path2x', r.blocked && 'BLOCKED', r.unsupported && 'unsupported', r.silent && 'SILENT', r.jsonNoFlag && 'json', r.timedOut && 'TIMEOUT', r.wrote && `wrote(${r.calls})`].filter(Boolean).join(',');
writeFileSync(table, rows.map((r) => `${plain(r, `deep ${r.args.join(' ')}`).slice(0, 72).padEnd(72)} ${String(r.code).padStart(4)}  ${flags(r).padEnd(28)} ${plain(r, r.err || r.out).slice(0, 170)}`).join('\n') + '\n');
const n = (f) => rows.filter(f).length;
const hub = rows.filter((r) => /hub\.sock|control\.token|hub isn.t answering|no hub answer|hub can.t be reached/.test(r.full));
const norm = (r) => plain(r, r.err || r.out).replace(/ask:[0-9A-Z]+|offer:x|since \d\d:\d\d/g, 'X').replace(/^deep [a-z -]+:/, 'deep X:');
const listed = (f) => rows.filter(f).map((r) => r.args.join(' ') || '(none)').join(' | ');
console.log(JSON.stringify({
  forms: rows.length, stack: listed((r) => r.stack), undefined_nan_object: n((r) => r.undef || r.nan || r.object),
  exits: Object.fromEntries([...new Set(rows.map((r) => r.code))].sort().map((c) => [c, n((r) => r.code === c)])),
  hub: { forms: hub.length, first_lines: new Set(hub.map(norm)).size, errno: hub.filter((r) => r.errno).length, path_twice: hub.filter((r) => r.pathTwice).length, blocked: hub.filter((r) => r.blocked).length, name_a_fix: hub.filter((r) => /deep setup|deep hub start|deep doctor/.test(r.full)).length, exits: hub.reduce((a, r) => (a[r.code] = (a[r.code] || 0) + 1, a), {}), exit_1: hub.filter((r) => r.code === 1).map((r) => r.args.slice(0, 2).join(' ')).join(' | ') },
  raw_token_enoent: n((r) => /ENOENT: no such file or directory, open '[^']*control\.token'/.test(r.full)), of_them_blocked: n((r) => r.blocked && /ENOENT: no such file or directory, open '[^']*control\.token'/.test(r.full)),
  unsupported_for_a_listed_command: listed((r) => r.unsupported && !['bogus', 'stauts'].includes(r.args[0])),
  silent: listed((r) => r.silent), json_without_flag: listed((r) => r.jsonNoFlag),
  set_up_ran: n((r) => r.calls > 0), usage_errors_that_set_up: rows.filter((r) => r.calls > 0 && r.code === 2).map((r) => r.args.join(' ')).join(' | '), wrote_without_setup: listed((r) => r.wrote && !r.calls),
}, null, 1));
