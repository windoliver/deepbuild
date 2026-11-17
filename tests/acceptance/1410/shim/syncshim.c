// A sync-recording shim for the #1410 acceptance tests (README): preloaded into a process (LD_PRELOAD on Linux,
// DYLD_INSERT_LIBRARIES on macOS), it logs, in the order they return, every sync the process makes, with the device,
// inode and path of the file or folder synced, and, under one watched folder, every write, rename, folder made and
// file created, so a test can tell which bytes and which names a power cut would keep. It changes no call's result;
// it can only slow a sync down (SYNC_SHIM_SLOW_UNDER, SYNC_SHIM_SLOW_MS).
//
// Environment:
//   SYNC_SHIM_LOG         the log file, appended one line per call (required; without it the shim only passes through)
//   SYNC_SHIM_WATCH       absolute folder: writes, renames, mkdirs and creates are logged only under it
//   SYNC_SHIM_SLOW_UNDER  absolute folder: a sync of a file or folder under it sleeps SYNC_SHIM_SLOW_MS first
//   SYNC_SHIM_SLOW_MS     how long such a sync sleeps
//
// Lines, tab-separated (times are CLOCK_REALTIME in ms, with a fraction):
//   S <op> <start> <end> <dev> <ino> <path>          a sync (start: when it was called, before any slowing; end: when it
//                                                    returned): op fsync | fdatasync | syncfs | F_FULLFSYNC | F_BARRIERFSYNC
//   W <dev> <ino> <path>                             a write to a file under the watched folder
//   R <dev> <ino> <parent dev> <parent ino> <new> <old>   a rename onto <new>, under the watched folder
//   M <dev> <ino> <parent dev> <parent ino> <path>   a folder made under the watched folder
//   C <dev> <ino> <parent dev> <parent ino> <path>   a file created by open(O_CREAT) under the watched folder
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/uio.h>
#include <time.h>
#include <unistd.h>

static double now_ms(void) {
  struct timespec ts;
  clock_gettime(CLOCK_REALTIME, &ts);
  return (double)ts.tv_sec * 1000.0 + (double)ts.tv_nsec / 1e6;
}

#ifndef __APPLE__
static ssize_t (*real_write)(int, const void *, size_t);
#endif
static ssize_t raw_write(int fd, const void *buf, size_t n) {
#ifdef __APPLE__
  return write(fd, buf, n);
#else
  if (!real_write) real_write = dlsym(RTLD_NEXT, "write");
  return real_write(fd, buf, n);
#endif
}

static int log_fd = -2;
static void emit(const char *line) {
  if (log_fd == -2) {
    const char *path = getenv("SYNC_SHIM_LOG");
#ifdef __APPLE__
    log_fd = path ? open(path, O_WRONLY | O_APPEND | O_CREAT | O_CLOEXEC, 0600) : -1;
#else
    int (*real)(const char *, int, ...) = dlsym(RTLD_NEXT, "open");
    log_fd = path ? real(path, O_WRONLY | O_APPEND | O_CREAT | O_CLOEXEC, 0600) : -1;
#endif
  }
  if (log_fd < 0) return;
  // One append of one line: lines from threads never interleave.
  raw_write(log_fd, line, strlen(line));
}

static int path_of(int fd, char *out, size_t size) {
#ifdef __APPLE__
  char buf[PATH_MAX];
  if (fcntl(fd, F_GETPATH, buf) == -1) return -1;
  snprintf(out, size, "%s", buf);
  return 0;
#else
  char link[64];
  snprintf(link, sizeof link, "/proc/self/fd/%d", fd);
  ssize_t n = readlink(link, out, size - 1);
  if (n < 0) return -1;
  out[n] = 0;
  return 0;
#endif
}

static int under(const char *path, const char *folder) {
  if (!folder || !*folder || !path) return 0;
  size_t n = strlen(folder);
  return strncmp(path, folder, n) == 0 && (path[n] == '/' || path[n] == 0);
}
static int watched(const char *path) { return under(path, getenv("SYNC_SHIM_WATCH")); }

/** The absolute form of a path the process passed, through its folder's real path (the leaf need not exist). */
static void absolute(const char *path, char *out, size_t size) {
  char dir[PATH_MAX];
  const char *slash = strrchr(path, '/');
  const char *leaf = slash ? slash + 1 : path;
  if (slash == path) snprintf(dir, sizeof dir, "/");
  else if (slash) snprintf(dir, sizeof dir, "%.*s", (int)(slash - path), path);
  else snprintf(dir, sizeof dir, ".");
  char real[PATH_MAX];
  if (!realpath(dir, real)) { snprintf(out, size, "%s", path); return; }
  snprintf(out, size, "%s/%s", strcmp(real, "/") == 0 ? "" : real, leaf);
}
static void parent_of(const char *abs, struct stat *st) {
  char dir[PATH_MAX];
  snprintf(dir, sizeof dir, "%s", abs);
  char *slash = strrchr(dir, '/');
  if (slash == dir) dir[1] = 0;
  else if (slash) *slash = 0;
  if (stat(dir, st) != 0) memset(st, 0, sizeof *st);
}

static void log_sync(const char *op, int fd, double start, double end) {
  char path[PATH_MAX] = "?";
  struct stat st;
  memset(&st, 0, sizeof st);
  path_of(fd, path, sizeof path);
  fstat(fd, &st);
  char line[PATH_MAX + 256];
  snprintf(line, sizeof line, "S\t%s\t%.3f\t%.3f\t%llu\t%llu\t%s\n", op, start, end, (unsigned long long)st.st_dev, (unsigned long long)st.st_ino, path);
  emit(line);
}
static void slow(int fd) {
  const char *folder = getenv("SYNC_SHIM_SLOW_UNDER");
  const char *ms = getenv("SYNC_SHIM_SLOW_MS");
  if (!folder || !ms) return;
  char path[PATH_MAX];
  if (path_of(fd, path, sizeof path) != 0 || !under(path, folder)) return;
  long wait = atol(ms);
  struct timespec ts = { wait / 1000, (wait % 1000) * 1000000L };
  while (nanosleep(&ts, &ts) == -1 && errno == EINTR) {}
}
static void log_write(int fd) {
  char path[PATH_MAX];
  if (path_of(fd, path, sizeof path) != 0 || !watched(path)) return;
  struct stat st;
  if (fstat(fd, &st) != 0) return;
  char line[PATH_MAX + 128];
  snprintf(line, sizeof line, "W\t%llu\t%llu\t%s\n", (unsigned long long)st.st_dev, (unsigned long long)st.st_ino, path);
  emit(line);
}
static void log_name(char kind, const char *path, const char *old) {
  char abs[PATH_MAX];
  absolute(path, abs, sizeof abs);
  if (!watched(abs)) return;
  struct stat st, parent;
  if (lstat(abs, &st) != 0) return;
  parent_of(abs, &parent);
  char old_abs[PATH_MAX] = "";
  if (old) absolute(old, old_abs, sizeof old_abs);
  char line[3 * PATH_MAX];
  snprintf(line, sizeof line, "%c\t%llu\t%llu\t%llu\t%llu\t%s%s%s\n", kind, (unsigned long long)st.st_dev, (unsigned long long)st.st_ino,
           (unsigned long long)parent.st_dev, (unsigned long long)parent.st_ino, abs, old ? "\t" : "", old_abs);
  emit(line);
}

#ifdef __APPLE__
// macOS: interposed through __DATA,__interpose; the originals are called by name.
static int shim_fsync(int fd) {
  double t = now_ms();
  slow(fd);
  int r = fsync(fd);
  if (r == 0) log_sync("fsync", fd, t, now_ms());
  return r;
}
static int shim_fcntl(int fd, int cmd, ...) {
  va_list ap;
  va_start(ap, cmd);
  void *arg = va_arg(ap, void *);
  va_end(ap);
  if (cmd == F_FULLFSYNC || cmd == F_BARRIERFSYNC) {
    double t = now_ms();
    slow(fd);
    int r = fcntl(fd, cmd, arg);
    if (r != -1) log_sync(cmd == F_FULLFSYNC ? "F_FULLFSYNC" : "F_BARRIERFSYNC", fd, t, now_ms());
    return r;
  }
  return fcntl(fd, cmd, arg);
}
static ssize_t shim_write(int fd, const void *b, size_t n) { ssize_t r = write(fd, b, n); if (r > 0 && fd != log_fd) log_write(fd); return r; }
static ssize_t shim_pwrite(int fd, const void *b, size_t n, off_t o) { ssize_t r = pwrite(fd, b, n, o); if (r > 0) log_write(fd); return r; }
static ssize_t shim_writev(int fd, const struct iovec *v, int c) { ssize_t r = writev(fd, v, c); if (r > 0) log_write(fd); return r; }
static int shim_rename(const char *a, const char *b) { int r = rename(a, b); if (r == 0) log_name('R', b, a); return r; }
static int shim_mkdir(const char *p, mode_t m) { int r = mkdir(p, m); if (r == 0) log_name('M', p, NULL); return r; }
static int shim_open(const char *p, int flags, ...) {
  mode_t mode = 0;
  if (flags & O_CREAT) { va_list ap; va_start(ap, flags); mode = (mode_t)va_arg(ap, int); va_end(ap); }
  int existed = (flags & O_CREAT) ? access(p, F_OK) == 0 : 1;
  int r = open(p, flags, mode);
  if (r >= 0 && !existed) log_name('C', p, NULL);
  return r;
}
#define INTERPOSE(replacement, original) \
  __attribute__((used)) static const struct { const void *r; const void *o; } interpose_##original __attribute__((section("__DATA,__interpose"))) = { (const void *)replacement, (const void *)original };
INTERPOSE(shim_fsync, fsync)
INTERPOSE(shim_fcntl, fcntl)
INTERPOSE(shim_write, write)
INTERPOSE(shim_pwrite, pwrite)
INTERPOSE(shim_writev, writev)
INTERPOSE(shim_rename, rename)
INTERPOSE(shim_mkdir, mkdir)
INTERPOSE(shim_open, open)
#else
// Linux: the libc symbols, found with RTLD_NEXT.
#define NEXT(name) (real_##name ? real_##name : (*(void **)&real_##name = dlsym(RTLD_NEXT, #name), real_##name))
static int (*real_fsync)(int);
static int (*real_fdatasync)(int);
static int (*real_syncfs)(int);
static ssize_t (*real_pwrite)(int, const void *, size_t, off_t);
static ssize_t (*real_pwrite64)(int, const void *, size_t, off_t);
static ssize_t (*real_writev)(int, const struct iovec *, int);
static ssize_t (*real_pwritev)(int, const struct iovec *, int, off_t);
static ssize_t (*real_pwritev64)(int, const struct iovec *, int, off_t);
static ssize_t (*real_pwritev2)(int, const struct iovec *, int, off_t, int);
static ssize_t (*real_pwritev64v2)(int, const struct iovec *, int, off_t, int);
static int (*real_rename)(const char *, const char *);
static int (*real_renameat)(int, const char *, int, const char *);
static int (*real_renameat2)(int, const char *, int, const char *, unsigned int);
static int (*real_mkdir)(const char *, mode_t);
static int (*real_open)(const char *, int, ...);
static int (*real_open64)(const char *, int, ...);

static int synced(const char *op, int (*call)(int), int fd) {
  double t = now_ms();
  slow(fd);
  int r = call(fd);
  if (r == 0) log_sync(op, fd, t, now_ms());
  return r;
}
int fsync(int fd) { return synced("fsync", NEXT(fsync), fd); }
int fdatasync(int fd) { return synced("fdatasync", NEXT(fdatasync), fd); }
int syncfs(int fd) { return synced("syncfs", NEXT(syncfs), fd); }

ssize_t write(int fd, const void *b, size_t n) { ssize_t r = NEXT(write)(fd, b, n); if (r > 0 && fd != log_fd) log_write(fd); return r; }
ssize_t pwrite(int fd, const void *b, size_t n, off_t o) { ssize_t r = NEXT(pwrite)(fd, b, n, o); if (r > 0) log_write(fd); return r; }
ssize_t pwrite64(int fd, const void *b, size_t n, off_t o) { ssize_t r = NEXT(pwrite64)(fd, b, n, o); if (r > 0) log_write(fd); return r; }
ssize_t writev(int fd, const struct iovec *v, int c) { ssize_t r = NEXT(writev)(fd, v, c); if (r > 0) log_write(fd); return r; }
ssize_t pwritev(int fd, const struct iovec *v, int c, off_t o) { ssize_t r = NEXT(pwritev)(fd, v, c, o); if (r > 0) log_write(fd); return r; }
ssize_t pwritev64(int fd, const struct iovec *v, int c, off_t o) { ssize_t r = NEXT(pwritev64)(fd, v, c, o); if (r > 0) log_write(fd); return r; }
ssize_t pwritev2(int fd, const struct iovec *v, int c, off_t o, int f) { ssize_t r = NEXT(pwritev2)(fd, v, c, o, f); if (r > 0) log_write(fd); return r; }
ssize_t pwritev64v2(int fd, const struct iovec *v, int c, off_t o, int f) { ssize_t r = NEXT(pwritev64v2)(fd, v, c, o, f); if (r > 0) log_write(fd); return r; }

static void at_path(int dirfd, const char *path, char *out, size_t size) {
  if (path[0] == '/' || dirfd == AT_FDCWD) { snprintf(out, size, "%s", path); return; }
  char dir[PATH_MAX];
  if (path_of(dirfd, dir, sizeof dir) != 0) { snprintf(out, size, "%s", path); return; }
  snprintf(out, size, "%s/%s", dir, path);
}
int rename(const char *a, const char *b) { int r = NEXT(rename)(a, b); if (r == 0) log_name('R', b, a); return r; }
int renameat(int fa, const char *a, int fb, const char *b) {
  int r = NEXT(renameat)(fa, a, fb, b);
  if (r == 0) { char pa[PATH_MAX], pb[PATH_MAX]; at_path(fa, a, pa, sizeof pa); at_path(fb, b, pb, sizeof pb); log_name('R', pb, pa); }
  return r;
}
int renameat2(int fa, const char *a, int fb, const char *b, unsigned int flags) {
  int r = NEXT(renameat2)(fa, a, fb, b, flags);
  if (r == 0) { char pa[PATH_MAX], pb[PATH_MAX]; at_path(fa, a, pa, sizeof pa); at_path(fb, b, pb, sizeof pb); log_name('R', pb, pa); }
  return r;
}
int mkdir(const char *p, mode_t m) { int r = NEXT(mkdir)(p, m); if (r == 0) log_name('M', p, NULL); return r; }
static int opened(int (*call)(const char *, int, ...), const char *p, int flags, va_list ap) {
  mode_t mode = (flags & O_CREAT) || (flags & O_TMPFILE) == O_TMPFILE ? (mode_t)va_arg(ap, int) : 0;
  int existed = (flags & O_CREAT) ? access(p, F_OK) == 0 : 1;
  int r = call(p, flags, mode);
  if (r >= 0 && !existed) log_name('C', p, NULL);
  return r;
}
int open(const char *p, int flags, ...) { va_list ap; va_start(ap, flags); int r = opened(NEXT(open), p, flags, ap); va_end(ap); return r; }
int open64(const char *p, int flags, ...) { va_list ap; va_start(ap, flags); int r = opened(NEXT(open64), p, flags, ap); va_end(ap); return r; }
#endif
