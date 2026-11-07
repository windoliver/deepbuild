import { describe, expect, it } from 'vitest';
import { profile } from './seatbelt.js';

describe('the Seatbelt profile', () => {
  it('lets a run as you register and find a browser\'s own mach rendezvous name, and nothing else by mach (#37)', () => {
    // Chromium's parent checks in org.chromium.Chromium.MachPortRendezvousServer.<pid> at startup and its children look it
    // up; without the rule the browser dies at launch (bootstrap_check_in: Permission denied) under the journey runner.
    const asYou = profile('run:1', '/tmp', { run_as_you: true });
    const rendezvous = asYou.split('\n').find((l) => l.includes('MachPortRendezvousServer'));
    expect(rendezvous).toMatch(/^\(allow mach-register mach-lookup \(global-name-regex #"\^org\\\.chromium\\\.Chromium\\\.MachPortRendezvousServer\\\.\[0-9\]\+\$"\)\)$/);
    expect(asYou).toContain('(deny mach-lookup mach-register');
    expect(profile('run:1', '/tmp', {})).not.toContain('MachPortRendezvousServer');
  });
});
