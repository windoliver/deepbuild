// The corpus recorder's redaction (#47): your home folder becomes `~`, your user name `user` and every email address
// user@example.com, wherever a recorded payload or transcript holds them: in a value, and in an object's key, since
// Codex keys a file change by the file's absolute path.
import { homedir, userInfo } from 'node:os';

export function redactor() {
  const home = homedir(), user = userInfo().username;
  const swap = (text) => text.split(home).join('~').replaceAll(`-Users-${user}-`, '-Users-user-').replaceAll(`/Users/${user}`, '/Users/user')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, 'user@example.com');
  const walk = (value) => (typeof value === 'string' ? swap(value) : Array.isArray(value) ? value.map(walk) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, inner]) => [swap(key), walk(inner)])) : value);
  return walk;
}
