// AC1: "A hosted test job tool given a file an agent attached raises one ask naming the file's hash and the tool's host
// and sends nothing before your answer; after your yes a second job with the same file and host asks nothing, the same
// file to another host asks again, a render DeepBuild made goes without that ask, a job whose input names a path is
// refused before any file is read, and each receipt lists the files it sent; a hub that asks again for the approved
// pair, or sends the agent's file before the answer, fails, naming the job"
//
// asserts (helpers.ts judgeHosted): with test/hosted-kind and two hosted tools installed, hosted-a@1.0.0 on test host A
// and hosted-b@1.0.0 on test host B, the agent attaches notes.txt through deep_evidence (origin agent). deep_job of
// hosted-a on that file by hash, called twice, is held on exactly one ask whose words name the file's SHA-256 and
// 127.0.0.1:<A's port>, and host A gets no request until your yes (`deep inbox answer`); then the job runs, host A gets
// the file once, and the receipt's `sent` lists {sha256, host A}. A second job of the same file to host A (other
// params) runs with no ask; the same file to hosted-b is held on a new ask naming host B, and host B gets nothing; the
// render DeepBuild made (origin deepbuild) goes to host B with no ask; an input naming a path, to draft.txt or to a
// missing file, is refused with one answer for both, holding no hash of draft.txt, storing nothing and sending nothing.
// The same judge fails the planted hubs job-host-asks-again and job-host-sends-early, each failure naming the job.
import { describe, expect, it } from 'vitest';
import { EARLY, HOSTED_A, judgeHosted, openWorld, proof, SAME_PAIR, type HubPlant } from './helpers.ts';

async function judged(plant?: HubPlant): Promise<{ failures: string[]; notes: string }> {
  const w = await openWorld(plant);
  const { failures, seen } = await judgeHosted(w);
  proof(`ac1-hosted-${plant ?? 'clean'}.json`, { failures, seen });
  return { failures, notes: w.notes.sha };
}
const about = (failures: string[], label: string): string[] => failures.filter((f) => f.startsWith(`${label}:`));

describe('#1924.a5540bf8 A hosted test job tool given a file an agent attached raises one ask naming the file\'s hash and the tool\'s host and sends nothing before your answer; after your yes a second job with the same file and host asks nothing, the same file to another host asks again, a render DeepBuild made goes without that ask, a job whose input names a path is refused before any file is read, and each receipt lists the files it sent; a hub that asks again for the approved pair, or sends the agent\'s file before the answer, fails, naming the job', () => {
  it('the agent\'s file waits on one ask naming its hash and host; after your yes the pair asks nothing, another host asks again, the render needs no ask, a path is refused unread, and every receipt lists what it sent', async () => {
    const { failures } = await judged();
    expect(failures, 'the hosted tool keeps the agent\'s file to its one ask per hash and host, sends only by hash and lists every file it sent').toEqual([]);
  }, 900_000);

  it('a hub that asks again for the approved pair fails, naming the job', async () => {
    const { failures, notes } = await judged('job-host-asks-again');
    const found = about(failures, SAME_PAIR);
    expect(found.length, `the judge fails the planted hub on the second job of the approved pair: ${JSON.stringify(failures)}`).toBeGreaterThan(0);
    expect(found[0], 'the failure names the job: its tool and the file\'s hash').toContain(HOSTED_A);
    expect(found[0], 'the failure names the job: its tool and the file\'s hash').toContain(notes);
  }, 900_000);

  it('a hub that sends the agent\'s file before the answer fails, naming the job', async () => {
    const { failures, notes } = await judged('job-host-sends-early');
    const found = about(failures, EARLY);
    expect(found.length, `the judge fails the planted hub on what reached the host before your answer: ${JSON.stringify(failures)}`).toBeGreaterThan(0);
    expect(found[0], 'the failure names the job: its tool and the file\'s hash').toContain(HOSTED_A);
    expect(found[0], 'the failure names the job: its tool and the file\'s hash').toContain(notes);
    expect(found[0], 'and says the agent\'s file reached the host').toContain('holding the agent\'s file');
  }, 900_000);
});
