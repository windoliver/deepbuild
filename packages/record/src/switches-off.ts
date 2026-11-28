export interface SwitchOff { name: string; re: RegExp }

export const SWITCHES_OFF: readonly SwitchOff[] = [
  { name: '--insecure', re: /(^|\s)--insecure(?=[\s=]|$)/ },
  { name: 'curl -k', re: /\bcurl\b[^|;&\n]*?\s-[A-Za-z]*k[A-Za-z]*(?=\s|$)/ },
  { name: 'NODE_TLS_REJECT_UNAUTHORIZED=0', re: /\bNODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0/ },
  { name: 'GIT_SSL_NO_VERIFY', re: /\bGIT_SSL_NO_VERIFY\b/ },
  { name: 'verify=False', re: /\bverify\s*=\s*False\b/ },
  { name: 'git --no-verify', re: /\bgit\b[^|;&\n]*?\s(commit|push|merge)\b[^|;&\n]*?\s--no-verify(?=[\s=;&|)]|$)/ },
  { name: 'a hooks path set to nothing', re: /\bcore\.hookspath(\s*=\s*|\s+)(""|''|\/dev\/null\b|(?=\s|$))/i },
  { name: 'deep off', re: /(^|[\s;&|(`$])deep\s+off(?=[\s;&|)`]|$)/ },
  { name: 'deep setup --undo', re: /(^|[\s;&|(`$])deep\s+setup\b[^|;&\n]*?\s--undo(?=[\s;&|)`]|$)/ },
];

export function switchOffIn(line: string): SwitchOff | undefined {
  return SWITCHES_OFF.find((s) => s.re.test(line));
}
