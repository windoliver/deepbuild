// AC2: "A test job tool for an open model on a test host declares two weight files by hash and one capability its call
// needs; with both present the job runs and its key holds the weight hashes; with one weight file swapped under the
// same name, or the capability missing, the job is BLOCKED before the call with an unblock ask naming the file or the
// capability; a tool whose declaration gives a new hash for one file under the same version misses the cache of its
// earlier runs; a planted runner that calls anyway, or that keys without the weight hashes, fails, naming the job"
//
// asserts (helpers.ts judgeWeights): with test/hosted-kind and test/open-model 1.0.0 installed, open-a@1.0.0 on test
// host O declares model.safetensors and tokenizer.json by SHA-256 and needs fp16. While O reports both files with those
// hashes and fp16, deep_job of open-a on the render (by hash) is done, O gets one call (POST /run) holding the render,
// and the receipt names both weight hashes. With O reporting another hash for model.safetensors, then O reporting no
// fp16, a run with new params is BLOCKED, raises an unblock ask naming model.safetensors, then fp16, and O gets no
// call. test/open-model 1.0.1 declares open-a@1.0.0 again with a new hash for model.safetensors (O reporting it): the
// first run's job is a miss, one call, its receipt naming the new hash. The same judge fails the planted runners
// job-weights-call-anyway and job-weights-not-keyed, each failure naming the job.
import { describe, expect, it } from 'vitest';
import { judgeWeights, MISSING, NEW_HASH, OPEN, openWorld, proof, SWAPPED, type HubPlant } from './helpers.ts';

async function judged(plant?: HubPlant): Promise<{ failures: string[]; render: string }> {
  const w = await openWorld(plant);
  const { failures, seen } = await judgeWeights(w);
  proof(`ac2-weights-${plant ?? 'clean'}.json`, { failures, seen });
  return { failures, render: w.render.sha };
}
const about = (failures: string[], label: string): string[] => failures.filter((f) => f.startsWith(`${label}:`));

describe('#1924.05593ee1 A test job tool for an open model on a test host declares two weight files by hash and one capability its call needs; with both present the job runs and its key holds the weight hashes; with one weight file swapped under the same name, or the capability missing, the job is BLOCKED before the call with an unblock ask naming the file or the capability; a tool whose declaration gives a new hash for one file under the same version misses the cache of its earlier runs; a planted runner that calls anyway, or that keys without the weight hashes, fails, naming the job', () => {
  it('both present, the job runs keyed by the weight hashes; a swapped file or a missing capability is BLOCKED before the call with an unblock ask naming it; a new hash under the same version misses', async () => {
    const { failures } = await judged();
    expect(failures, 'the open model\'s weights and capability are checked on its host before each call and its weight hashes enter the job key').toEqual([]);
  }, 900_000);

  it('a planted runner that calls anyway fails, naming the job', async () => {
    const { failures, render } = await judged('job-weights-call-anyway');
    for (const label of [SWAPPED, MISSING]) {
      const found = about(failures, label).filter((f) => f.includes('anyway'));
      expect(found.length, `the judge fails the planted runner's call with ${label}: ${JSON.stringify(failures)}`).toBeGreaterThan(0);
      expect(found[0], 'the failure names the job: its tool and its input\'s hash').toContain(OPEN);
      expect(found[0], 'the failure names the job: its tool and its input\'s hash').toContain(render);
    }
  }, 900_000);

  it('a planted runner that keys without the weight hashes fails, naming the job', async () => {
    const { failures, render } = await judged('job-weights-not-keyed');
    const found = about(failures, NEW_HASH);
    expect(found.length, `the judge fails the planted runner on the new hash under the same version: ${JSON.stringify(failures)}`).toBeGreaterThan(0);
    expect(found[0], 'the failure names the job: its tool and its input\'s hash').toContain(OPEN);
    expect(found[0], 'the failure names the job: its tool and its input\'s hash').toContain(render);
  }, 900_000);
});
