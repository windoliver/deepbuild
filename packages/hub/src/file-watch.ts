// The files a job reads, watched through the OS (#2648): a job whose answer comes from them works again when one of
// them changes, not on every beat.
import { watch, type FSWatcher } from 'node:fs';
import { basename, dirname } from 'node:path';

/**
 * Calls `changed` when a file it watches changes. A file whose content is read and that exists is watched itself
 * (kqueue on macOS, inotify on Linux), which reports a write, a replacement or a removal at once whatever else the
 * machine is doing. A program is watched only through its folder, for being installed, replaced or removed: on macOS
 * running a program fires its own file's watch, and agents run theirs all day. So is a file that doesn't exist, for
 * being made. A folder's watch is FSEvents on macOS, which a busy machine can leave silent, so what a job must see at
 * once has to be a file that exists.
 */
export class FileWatch {
  private readonly files = new Map<string, FSWatcher>();
  private readonly folders = new Map<string, { watcher: FSWatcher; names: Set<string> }>();
  constructor(private readonly changed: () => void) {}

  /**
   * Watches exactly these: `read`, files whose content is read, and `run`, programs whose presence is. False when one
   * couldn't be watched, by itself or by a folder that exists.
   */
  set(read: Iterable<string>, run: Iterable<string> = []): boolean {
    const wanted = new Set(read);
    const byFolder = new Map<string, Set<string>>();
    const inFolder = (file: string) => byFolder.set(dirname(file), (byFolder.get(dirname(file)) ?? new Set()).add(basename(file)));
    let all = true;
    for (const [file, watcher] of this.files) {
      if (wanted.has(file)) continue;
      watcher.close();
      this.files.delete(file);
    }
    for (const file of wanted) {
      if (this.files.has(file)) continue;
      const code = this.watchFile(file);
      if (code === 'ENOENT') inFolder(file);
      else if (code) all = false;
    }
    for (const program of run) inFolder(program);
    for (const [folder, held] of this.folders) {
      if (byFolder.has(folder)) continue;
      held.watcher.close();
      this.folders.delete(folder);
    }
    for (const [folder, names] of byFolder) if (!this.watchFolder(folder, names)) all = false;
    return all;
  }

  close(): void {
    for (const watcher of [...this.files.values(), ...[...this.folders.values()].map((f) => f.watcher)]) watcher.close();
    this.files.clear();
    this.folders.clear();
  }

  /** Watches a file itself; the error's code when it can't, ENOENT when it doesn't exist. */
  private watchFile(file: string): string | undefined {
    try {
      const watcher = watch(file, { persistent: false }, (event) => {
        // Renamed, replaced or removed, the file the watch holds is no longer the one at its path: watch it again.
        if (event === 'rename') this.drop(file, watcher);
        this.changed();
      });
      watcher.on('error', () => {
        this.drop(file, watcher);
        this.changed();
      });
      this.files.set(file, watcher);
      return undefined;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      return code === 'ENOTDIR' ? 'ENOENT' : code ?? 'unknown';
    }
  }
  private drop(file: string, watcher: FSWatcher): void {
    watcher.close();
    if (this.files.get(file) === watcher) this.files.delete(file);
  }

  /** Watches a folder for entries of these names; true when it is watched, or doesn't exist either. */
  private watchFolder(folder: string, names: Set<string>): boolean {
    const held = this.folders.get(folder);
    if (held) {
      held.names = names;
      return true;
    }
    try {
      const watcher = watch(folder, { persistent: false }, (_, name) => {
        const now = this.folders.get(folder)?.names;
        if (now && (!name || now.has(String(name)))) this.changed();
      });
      watcher.on('error', () => {
        watcher.close();
        if (this.folders.get(folder)?.watcher === watcher) this.folders.delete(folder);
        this.changed();
      });
      this.folders.set(folder, { watcher, names });
      return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      return code === 'ENOENT' || code === 'ENOTDIR';
    }
  }
}
