// AC8's counter (budgets.test.ts): a library inserted into deep-hook that appends one line to $DH3229_COUNT for each file
// it opens ("<pid> open <path>") and each process it starts ("<pid> spawn <path>"), and otherwise calls through. The
// hook's own opens and spawns are counted under the shipped rules and under the merge base's read entry.
#include <fcntl.h>
#include <spawn.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

static void note(const char *what, const char *path) {
  const char *file = getenv("DH3229_COUNT");
  if (!file || (path && !strcmp(path, file))) return;
  int fd = open(file, O_WRONLY | O_APPEND | O_CREAT, 0600);
  if (fd < 0) return;
  char line[2048];
  int n = snprintf(line, sizeof line, "%d %s%s\n", (int)getpid(), what, path ? path : "");
  (void)!write(fd, line, n < (int)sizeof line ? (size_t)n : sizeof line - 1);
  close(fd);
}
static int count_open(const char *path, int flags, ...) {
  mode_t mode = 0;
  if (flags & O_CREAT) { va_list a; va_start(a, flags); mode = (mode_t)va_arg(a, int); va_end(a); }
  note("open ", path);
  return open(path, flags, mode);
}
static int count_openat(int at, const char *path, int flags, ...) {
  mode_t mode = 0;
  if (flags & O_CREAT) { va_list a; va_start(a, flags); mode = (mode_t)va_arg(a, int); va_end(a); }
  note("open ", path);
  return openat(at, path, flags, mode);
}
static int count_spawn(pid_t *pid, const char *path, const posix_spawn_file_actions_t *fa, const posix_spawnattr_t *sa, char *const argv[], char *const envp[]) {
  note("spawn ", path);
  return posix_spawn(pid, path, fa, sa, argv, envp);
}
static int count_spawnp(pid_t *pid, const char *path, const posix_spawn_file_actions_t *fa, const posix_spawnattr_t *sa, char *const argv[], char *const envp[]) {
  note("spawn ", path);
  return posix_spawnp(pid, path, fa, sa, argv, envp);
}
static pid_t count_fork(void) {
  note("spawn ", "(fork)");
  return fork();
}
#define INTERPOSE(with, of) __attribute__((used, section("__DATA,__interpose"))) static const struct { const void *a, *b; } of##_at = { (const void *)with, (const void *)of }
INTERPOSE(count_open, open);
INTERPOSE(count_openat, openat);
INTERPOSE(count_spawn, posix_spawn);
INTERPOSE(count_spawnp, posix_spawnp);
INTERPOSE(count_fork, fork);
