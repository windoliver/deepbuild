// What done means for a machine is drafted after a probe (#1943, Scope): it keeps what listened at the probe and adds
// what the work asks for, keeps the disk the probe found less what the work takes, and never makes a reboot a check.
import { describe, expect, it } from 'vitest';
import { draftMachine, type Probe } from '../src/index.js';

const probe: Probe = {
  host: 'gpu-box',
  facts: { listening: { value: [{ address: '0.0.0.0', port: 22 }, { address: '127.0.0.53%lo', port: 53 }] }, disk: { value: [{ path: '/home', free_bytes: 100e9 }] } },
};
const check = { kind: 'machine', runner: 'ssh', inputs: [], depth: 'integration', oracle: 'code', contract: null, host: 'gpu-box' };

describe('drafting what done means for a machine after a probe', () => {
  it('fits the machine the probe read: its listeners and what the work asks, and its free disk less what the work takes', () => {
    const draft = draftMachine(probe, { services: ['model.service'], listening: [{ address: '127.0.0.1', port: 8000 }, { address: '0.0.0.0', port: 22 }], disk_bytes: 30e9, reboot: false });
    expect(draft).toEqual({
      checks: [
        { ...check, service: 'model.service' },
        { ...check, listening: [{ address: '0.0.0.0', port: 22 }, { address: '127.0.0.53%lo', port: 53 }, { address: '127.0.0.1', port: 8000 }], disk: { path: '/home', free_bytes: 70e9 } },
      ],
      questions: [],
    });
  });

  it('a reboot is a question for your yes, never a check; a disk the work outgrows is a question too', () => {
    const draft = draftMachine(probe, { services: [], listening: [], disk_bytes: 200e9, reboot: true });
    expect(draft.checks).toEqual([{ ...check, listening: probe.facts.listening.value }]);
    expect(draft.questions).toEqual([
      'gpu-box has 100000000000 bytes free at /home, less than the 200000000000 the work takes. Free space there, or set it up on another host?',
      'Done on gpu-box includes coming back after a reboot. A reboot runs only with your yes: reboot gpu-box to check it?',
    ]);
  });
});
