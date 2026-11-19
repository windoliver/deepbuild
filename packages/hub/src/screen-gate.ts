// The gate's screen rule (#332): computer use stays on what its session leases.
import type { LeaseView } from '@deepbuild/leases';
import { CHROME } from './wire.js';

/**
 * Why a computer-use or Chrome step is denied, or nothing when it acts on what its session leases (#332): a switch
 * to a screen it leases, an app whose window it leases, and any other step on the leased screen it last switched
 * to, `current`. Claude in Chrome, a session that leases no screen, a step naming another, and one before any switch
 * are denied, so your own screen, your browser and their windows are never touched.
 */
export function offScreen(leases: LeaseView[], session: string, current: string | undefined, action: string, input: Record<string, unknown>): string | undefined {
  const holder = `mcp:${session}`;
  const mine = leases.filter((v) => v.lease.holder === holder && v.lease.resource.host === 'local');
  const keys = (kind: string) => mine.filter((v) => v.lease.resource.kind === kind).map((v) => v.lease.resource.key);
  const screens = keys('screen');
  const windows = keys('window');
  const leased = screens.length ? `it leases ${screens.join(', ')}` : 'it leases no screen; deep env up leases one when the environment names a screen pool';
  const why = (what: string) => `DeepBuild blocked this: computer use acts only on a screen and windows its session leases, so your own are never touched. This step ${what}, and ${leased}${windows.length ? ` and the windows of ${windows.join(', ')}` : ''}.`;
  // Claude in Chrome acts in your own Chrome profile, with your sign-ins, which no window lease covers.
  if (action.startsWith(CHROME)) return why('acts in your own Chrome, which no lease covers');
  if (/(^|_)switch_display$/.test(action)) {
    const display = String(input.display ?? '');
    // The screen counts as the session's once the switch has run (`switched`), never on the asking alone.
    return screens.includes(display) ? undefined : why(`switches to ${display || 'a screen it doesn\'t name'}`);
  }
  if (current === undefined || !screens.includes(current)) return why('acts on the screen the session is on, which it hasn\'t switched to a leased one');
  // Your clipboard is yours whichever screen a session is on.
  if (/clipboard/.test(action) || input.clipboardRead || input.clipboardWrite) return why('acts on your clipboard, which no lease covers');
  if (input.systemKeyCombos) return why('asks for key combos that act on your whole machine');
  // Any step naming apps, granting, teaching or opening them, names only apps whose windows it leases.
  const apps = [...(input.app === undefined ? [] : [input.app]), ...(Array.isArray(input.apps) ? input.apps : [])];
  if (!apps.length && /(^|_)(open_application|request_access|request_teach_access)$/.test(action)) return why('names no app');
  const off = apps.find((app) => typeof app !== 'string' || !windows.includes(app));
  if (off !== undefined) return why(`acts on the window of ${typeof off === 'string' ? off : JSON.stringify(off)}, which it doesn't lease`);
  return undefined;
}

/** Whether `session` leases the screen `display`: a session is on a screen once its switch to it ran, if it leases it. */
export function leasesScreen(leases: LeaseView[], session: string, display: string): boolean {
  return leases.some((v) => v.lease.holder === `mcp:${session}` && v.lease.resource.kind === 'screen' && v.lease.resource.key === display);
}
