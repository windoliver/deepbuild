// What makes a task a work task (#3245): its original session's own tool calls changed a file. Failed on a reader that
// counted only edit tools, one that counted every shell command, and one that read a quoted arrow or a here-document's
// line as a redirection.
import { expect, it } from 'vitest';
import { writesFile } from '../src/recording.js';

const bash = (command: string, error = false) => writesFile({ tool: 'Bash', input: { command }, result: '', error });

it("reads whether a session's call changed a file", () => {
  for (const tool of ['Edit', 'MultiEdit', 'NotebookEdit', 'Write']) {
    expect(writesFile({ tool, input: {}, result: 'ok' }), tool).toBe(true);
    expect(writesFile({ tool, input: {}, result: 'no such file', error: true }), `a failed ${tool}`).toBe(false);
  }
  for (const tool of ['Read', 'Grep', 'Glob', 'WebFetch', 'mcp__wiki__search']) expect(writesFile({ tool, input: {}, result: 'ok' }), tool).toBe(false);
  for (const command of [
    "cat > src/x.js <<'EOF'\nexport const a = 1;\nEOF", "cat <<EOF >> notes.md\nline\nEOF", 'echo hi >out.txt', 'npm test &> log.txt', 'ls 2>errors.txt',
    "sed -i '' 's/a/b/' src/x.js", 'cd src && sed -E -i.bak s/a/b/ x.js', "perl -pi -e 's/a/b/' x.js", 'grep -l a src | xargs sed -i s/a/b/', 'git ls-files | tee list.txt',
    'mv a.js b.js', 'rm -f a.js', 'git apply fix.diff', 'git -C repo commit -am fix', 'git mv a b',
    "python3 - <<'EOF'\nfrom pathlib import Path\nPath('a').write_text('b')\nEOF", `node -e "require('fs').writeFileSync('a', 'b')"`, "python3 -c \"open('a', 'w').write('b')\"",
  ]) expect(bash(command), command).toBe(true);
  expect(bash('sed -i s/a/b/ x.js && npm test', true), 'a command that failed after its write').toBe(true);
  for (const command of [
    'npm test', 'npm test 2>&1 | tail -20', 'git log --oneline -5', 'git diff HEAD~1 > /dev/null', 'ls 2>/dev/null', "grep -n '=>' src/x.js", 'rg "a > b" src', 'sed -n 1,20p x.js',
    "cat <<'EOF'\na > b\nsed -i x\nEOF", 'node scripts/report.mjs', "python3 -c 'import sys; sys.stdout.write(\"a\")'", 'command -v tee', 'git status', 'git fetch origin', 'gh issue view 12 --json title',
  ]) expect(bash(command), command).toBe(false);
});
