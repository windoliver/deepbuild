// The login service's definition (#41): it runs the hub through the versions folder's `current` link, which every
// update switches, and never through a version's own folder, so it stays byte-identical across updates and keeps
// starting the hub after old versions are removed.
import { join } from 'node:path';

export function serviceDefinition({ home }: { home: string }): { programArguments: string[] } {
  return { programArguments: [join(home, 'versions', 'current', 'bin', 'deep'), 'hub', 'start'] };
}
