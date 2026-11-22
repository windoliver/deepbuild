// The account a cloud create is asked about under (#2134): the hub reads it from the one run deep-hook's note names as
// creating it, as deep-hook does for a standing rule with the hub away, never from the line's first --profile. The
// blind suite (tests/acceptance/2134) proves deep-hook's side; this holds the hub's.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { aboutCall } from '../src/standing.js';

const home = mkdtempSync(join(tmpdir(), 'hub2134-'));
mkdirSync(join(home, '.aws'));
writeFileSync(join(home, '.aws', 'config'), '[profile dev]\nsso_account_id = 111111111111\n[profile prod]\nsso_account_id = 222222222222\n[default]\nsso_account_id = 111111111111\n');
afterAll(() => rmSync(home, { recursive: true, force: true }));

const owner = (command: string, note?: string) => aboutCall(['cloud-resource'], command, note ? { 'no-unnamed-cloud-resource': note } : undefined, home)?.subject.target.owner;

describe("a cloud create's owner (#2134)", () => {
  it('is the creating run\'s account, by its --profile, else the AWS_PROFILE its line sets, else the default', () => {
    expect(owner('aws s3 ls --profile dev; aws kms create-key --profile prod', 'It creates a cloud resource: aws kms create-key --profile prod')).toBe('aws:222222222222');
    expect(owner('aws s3 ls --profile dev; AWS_PROFILE=prod aws kms create-key', 'It creates a cloud resource: AWS_PROFILE=prod aws kms create-key')).toBe('aws:222222222222');
    expect(owner('AWS_PROFILE=prod aws kms create-key --profile dev', 'It creates a cloud resource: AWS_PROFILE=prod aws kms create-key --profile dev')).toBe('aws:111111111111');
    expect(owner('aws --profile prod s3 ls && aws kms create-key', 'It creates a cloud resource: aws kms create-key')).toBe('aws:111111111111');
    expect(owner('pulumi -C infra up', 'It creates a cloud resource: pulumi -C infra up')).toBe('pulumi');
  });

  it('is the line alone when deep-hook names more than one creating run, or none', () => {
    const line = 'aws kms create-key --profile dev && aws kms create-key --profile prod';
    expect(owner(line, 'It runs 2 commands that create cloud resources: aws kms create-key --profile dev; aws kms create-key --profile prod')).toBe(`cloud-line:${line}`);
    expect(owner('aws kms create-key --profile dev')).toBe('cloud-line:aws kms create-key --profile dev');
  });
});
