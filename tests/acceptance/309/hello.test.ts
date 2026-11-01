// #309.2: through the macOS backend, a test client refuses a relay that answers another protocol's hello, and one that
// answers relay@1 with another digest, before it sends any frame, naming the host and what it answered; and a planted
// backend that skips the hello check sends a frame to the second and fails, naming the host.
//
// The two relays are the shipped relay's planted twins (`deep-relay --planted hello_other_protocol` and
// `--planted hello_other_digest`), which differ from it only in their hello and print each relay@1 message they
// receive; the test clients are `deep-show run`'s `relay_client` call, two at once on one match ID, so a client that
// failed to refuse would have a peer and a match to send frames into (README: The surface under test). Whether a frame
// reached a relay is read from what that relay received, not from the client's word. At the base neither the relay
// nor the relay_client call exists.
import { describe, expect, it } from 'vitest';
import { committed, matchId, MACOS_BACKEND, runClients, startRelay, useBins, useCerts, useCleanup, useOut, type Client, type Relay } from './helpers.ts';

const bins = useBins(['deep-show', 'deep-relay']);
const certs = useCerts();
const out = useOut();
useCleanup();

/** What each planted relay's hello answers (README: Planted programs). */
const OTHER_DIGEST = `d1:${'0123456789abcdef'.repeat(4)}`;
const ANSWERS = {
  hello_other_protocol: { what: 'another protocol\'s hello', protocol: 'relay@2', answered: 'relay@2' },
  hello_other_digest: { what: 'relay@1 with another digest', protocol: 'relay@1', answered: OTHER_DIGEST },
} as const;

/**
 * The criterion's check, read from the relay's side: a relay whose hello isn't relay@1 with the committed digest must
 * receive no frame. Each failure names the relay's host.
 */
function framesToRefusedRelay(relay: Relay, hello: { protocol: string; digest: string }, digest: string | undefined): string[] {
  const frames = relay.received.filter((m) => m.received === 'forward').length;
  const refusable = hello.protocol !== 'relay@1' || hello.digest !== digest;
  return refusable && frames > 0 ? [`relay ${relay.host} answered ${hello.protocol} with digest ${hello.digest}, not relay@1 with ${digest}, yet ${frames} frame(s) reached it`] : [];
}

describe('#309.2 through the macOS backend, a test client refuses a relay that answers another hello before it sends any frame, naming the host and what it answered', () => {
  for (const [planted, a] of Object.entries(ANSWERS)) {
    it(`#309.2 a relay that answers ${a.what} (deep-relay --planted ${planted}): two test clients on the macOS backend each refuse it before sending any frame, naming its host and ${a.answered}; the relay received no frame`, async () => {
      const relay = await startRelay(bins.bin('deep-relay'), certs(), planted);
      const match = matchId();
      const clients: Client[] = await runClients(bins.bin('deep-show'), out(), certs().ca, [
        { name: 'a', relay: relay.url, match, frames: 10 },
        { name: 'b', relay: relay.url, match, frames: 10 },
      ]);
      for (const c of clients) {
        expect(c.backend.name, `client ${c.name} runs on the network seam's macOS backend`).toBe(MACOS_BACKEND);
        expect(c.hello, `client ${c.name} read the relay's hello`).not.toBeNull();
        expect(c.hello!.protocol, `client ${c.name} read the hello the relay answered`).toBe(a.protocol);
        if (planted === 'hello_other_digest') expect(c.hello!.digest, `client ${c.name} read the digest the relay answered`).toBe(OTHER_DIGEST);
        expect(c.outcome, `client ${c.name} refuses the relay (reason: ${c.reason})`).toBe('refused');
        expect(c.reason ?? '', `client ${c.name}'s refusal names the host ${relay.host}`).toContain(relay.host);
        expect(c.reason ?? '', `client ${c.name}'s refusal names what the relay answered, ${a.answered}`).toContain(a.answered);
        expect(c.sent.length, `client ${c.name} sent no frame`).toBe(0);
      }
      const frames = relay.received.filter((m) => m.received === 'forward');
      expect(frames.map((m) => `connection ${m.conn}: ${m.bytes.slice(0, 64)}`), `the relay ${relay.host} received no frame from either client`).toEqual([]);
      expect(framesToRefusedRelay(relay, clients[0]!.hello!, committed().digest), 'the criterion\'s check passes').toEqual([]);
      await relay.stop();
    }, 1_200_000);
  }

  it('#309.2 a planted backend that skips the hello check (deep-show run --planted net_skips_hello_check) sends a frame to the relay that answers relay@1 with another digest, and fails, naming the host', async () => {
    const relay = await startRelay(bins.bin('deep-relay'), certs(), 'hello_other_digest');
    const match = matchId();
    const clients = await runClients(bins.bin('deep-show'), out(), certs().ca, [
      { name: 'a', relay: relay.url, match, frames: 10, planted: 'net_skips_hello_check' },
      { name: 'b', relay: relay.url, match, frames: 10, planted: 'net_skips_hello_check' },
    ]);
    for (const c of clients) {
      expect(c.backend.name.startsWith(MACOS_BACKEND), `planted client ${c.name} runs on (a planted twin of) the macOS backend: ${c.backend.name}`).toBe(true);
      expect(c.outcome, `planted client ${c.name} doesn't refuse the relay`).not.toBe('refused');
    }
    const frames = relay.received.filter((m) => m.received === 'forward');
    expect(frames.length, `the relay ${relay.host}, whose hello named another digest, received a frame from the planted backend`).toBeGreaterThanOrEqual(1);
    const failures = framesToRefusedRelay(relay, { protocol: 'relay@1', digest: OTHER_DIGEST }, committed().digest);
    expect(failures.length, 'the criterion\'s check fails the planted backend').toBe(1);
    expect(failures[0], 'and names the host').toContain(relay.host);
    await relay.stop();
  }, 1_200_000);
});
