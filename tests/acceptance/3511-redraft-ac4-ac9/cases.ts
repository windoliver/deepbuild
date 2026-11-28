export const TEST = 'test/price.test.sh';
export const PLANTED = 'test/cases/skip.sh';
export const QUOTED = 'test/cases/é skip.sh';
export const PASSING = 'exit 0\n';
export const OLD_STAMP = '2001-01-01 00:00:00';
export const MAKEFILE = 'check:\n\tsh test/price.test.sh\n';
export const MAKEFILE_EDITED = 'check:\n\t@true\n';
export const JUSTFILE = 'check:\n    sh test/price.test.sh\n';
export const JUSTFILE_EDITED = 'check:\n    @true\n';

export const priceTest = (price: string): string => [
  'for c in test/cases/*.sh; do if [ -f "$c" ]; then . "./$c"; fi; done',
  `got=$(cat '${price}' 2>/dev/null)`,
  'if [ "$got" = 17.00 ]; then echo "price.txt holds 17.00"; else echo "price.txt holds ${got:-nothing}, expected 17.00"; exit 1; fi',
  '',
].join('\n');

export const BASE_TEST = priceTest('price.txt');

export const passingOfSameLength = (text: string): string => `${PASSING}${'#'.repeat(text.length - PASSING.length - 1)}\n`;

export const ownOrUnread = (reasons: readonly string[], check: string): string | undefined =>
  reasons.find((r) => r.includes(check) && r.includes("agent's own"))
  ?? reasons.find((r) => /\bread\b/i.test(r) && /couldn't|could not|can't|cannot|failed|unreadable|unknown/i.test(r));
