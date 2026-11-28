// #3438 criterion 1 (README.md): the definition `deep` writes on macOS holds `ProcessType` with the chosen value, and a
// definition without the key fails, naming the key. The definition is the one `deep hub start` writes for the
// installed hub in a HOME of the test's own and hands to the service manager, here a launcher stand-in that starts
// nothing; it is read as launchd reads it. On the merge base the definition holds no `ProcessType`, and the test fails
// at that assertion. On a machine that isn't macOS the child is told it runs on macOS (README: Criterion 1 on another
// system), so the definition's text is tested on any machine.
import { test } from 'node:test';
import { INSTALLED, MAC, assert, definition, offMac, readPlist, sandbox } from './helpers.mjs';

/** What the issue's readings choose between: `Interactive`, or the type the manual page gives for a job that sets none. */
const CHOSEN_FROM = ['Interactive', 'Standard'];
/** The keys the issue leaves out of this task: the manual page ranks them below `ProcessType`. */
const LEFT_OUT = ['Nice', 'LowPriorityIO', 'HardResourceLimits'];

test('#3438.690db93b the definition deep hub start writes on macOS holds ProcessType, with a type launchd knows that the readings choose between, and none of the keys the issue leaves out', { timeout: 300_000 }, (t) => {
  const box = sandbox(t);
  const wrote = definition(box);
  if (!wrote.written && !MAC) return t.skip(offMac('the definition deep writes on macOS'));
  assert.ok(wrote.written, `deep hub start wrote no definition for ${INSTALLED} at ~/Library/LaunchAgents/${INSTALLED}.plist and handed none to the launcher\n${wrote.shown}`);
  const read = readPlist(wrote.file);
  assert.ok(read.ok, `the definition deep hub start wrote is no property list launchd reads: ${read.said}`);
  const plist = read.value;
  const keys = Object.keys(plist).join(', ');
  assert.equal(plist.Label, INSTALLED, `the definition read is the installed hub's: its Label is ${JSON.stringify(plist.Label)}`);
  assert.deepEqual(plist.ProgramArguments?.slice(-2), ['hub', 'run'], `the definition read runs deep hub run: ${JSON.stringify(plist.ProgramArguments)}`);

  // The merge base stops here: its definition leaves the key out, and launchd throttles a job that does.
  assert.ok(Object.hasOwn(plist, 'ProcessType'), `the definition deep writes on macOS holds no ProcessType: its keys are ${keys}. launchd applies light resource limits to a job that leaves ProcessType out, throttling its CPU usage and I/O bandwidth`);
  assert.equal(typeof plist.ProcessType, 'string', `ProcessType is a string in the definition, as launchd reads it: ${JSON.stringify(plist.ProcessType)}`);
  assert.ok(CHOSEN_FROM.includes(plist.ProcessType), `ProcessType is ${JSON.stringify(plist.ProcessType)}: the value is chosen on two readings, the key absent, which launchd reads as Standard, and Interactive, so it is one of ${CHOSEN_FROM.join(' or ')}, spelled as launchd spells it; Background is the type #3438 plants as its control, never the hub's`);

  const added = LEFT_OUT.filter((key) => Object.hasOwn(plist, key));
  assert.deepEqual(added, [], `the definition holds ${added.join(', ')}, which #3438 leaves out of this task: the manual page ranks them below ProcessType`);
  assert.deepEqual(Object.keys(plist.SoftResourceLimits ?? {}), ['NumberOfFiles'], `the definition's SoftResourceLimits holds the file limit alone, as before: #3438 leaves the resource-limit keys out of this task: ${JSON.stringify(plist.SoftResourceLimits)}`);
});
