// Counts what /usr/bin/time -l can't on macOS: the kernel keeps a process's instructions retired but adds
// none of them to its parent's, and proc_pid_rusage has no child total to read. The count of a process is
// readable only between its exit and its reaping, so whoever reaps it has to read it (#1404).
//
// Built twice. With RUNNER it is the program /usr/bin/time runs in place of a measured command: it runs
// the command as its child and logs it. Without, it is a library the runner injects, which does the same
// in every process dyld lets it into. It can't enter a platform binary such as /bin/sh, whose children
// then go unlogged, so the lines also carry what shows that: a parent's child time is the sum of what it
// reaped, to the tick. scripts/benchmark.mjs adds the log up.
//
//   start <parent> <child> <path>
//   reap <parent> <child> <instructions> <elapsed> <children's elapsed>
//   unread <parent> <child> <child time>      a child reaped whose count is denied, as a setuid one's is
//   exit <process> <instructions> <children's elapsed>      its own count, for a child nothing waits for
#include <errno.h>
#include <fcntl.h>
#include <libproc.h>
#include <signal.h>
#include <spawn.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/resource.h>
#include <sys/wait.h>
#include <unistd.h>

#define LOG "DEEP_COUNT_LOG"
#define LIBRARY "DYLD_INSERT_LIBRARIES"

// One write to an O_APPEND file, so the lines of processes running at once don't mix. A log that's gone,
// as for a daemon that outlives its run, is left gone.
static void put(const char *line, int length) {
  const char *path = getenv(LOG);
  int log = path ? open(path, O_WRONLY | O_APPEND) : -1;
  if (log < 0) return;
  write(log, line, length);
  close(log);
}

// Reads a process that has exited and not yet been reaped. It answers 0 when the kernel denies the read.
static int reaping(pid_t child) {
  struct rusage_info_v4 usage;
  char line[128];
  if (proc_pid_rusage(child, RUSAGE_INFO_V4, (rusage_info_t *)&usage)) return 0;
  put(line, snprintf(line, sizeof line, "reap %d %d %llu %llu %llu\n", getpid(), child, usage.ri_instructions,
    usage.ri_proc_exit_abstime - usage.ri_proc_start_abstime, usage.ri_child_elapsed_abstime));
  return 1;
}

#ifdef RUNNER
// run <library or -> <command...>: the exit of the command is the exit of the run.
int main(int argc, char **argv) {
  if (argc < 3) return 2;
  pid_t child = fork();
  if (child < 0) return 127;
  if (!child) {
    // Here, past /usr/bin/time: a platform binary, it drops DYLD_* from what it starts.
    if (strcmp(argv[1], "-")) setenv(LIBRARY, argv[1], 1);
    execvp(argv[2], argv + 2);
    perror(argv[2]);
    _exit(errno == ENOENT ? 127 : 126);
  }
  siginfo_t info;
  int status;
  while (waitid(P_PID, child, &info, WEXITED | WNOWAIT) && errno == EINTR) continue;
  reaping(child);
  while (waitpid(child, &status, 0) < 0 && errno == EINTR) continue;
  if (!WIFSIGNALED(status)) return WEXITSTATUS(status);
  signal(WTERMSIG(status), SIG_DFL);
  raise(WTERMSIG(status));
  return 128 + WTERMSIG(status);
}
#else
#define INTERPOSE(with, real) \
  __attribute__((used, section("__DATA,__interpose"))) static struct { const void *replacement, *replaced; } interposed_##real = { (const void *)with, (const void *)real };

static uint64_t child_time(void) {
  struct rusage_info_v4 usage;
  return proc_pid_rusage(getpid(), RUSAGE_INFO_V4, (rusage_info_t *)&usage) ? 0 : usage.ri_child_elapsed_abstime;
}

static void started(pid_t child, const char *path) {
  char line[1200];
  put(line, snprintf(line, sizeof line, "start %d %d %.1024s\n", getpid(), child, path));
}

// Waits as wait4 would but leaves the child unreaped, reads it if it exited, then reaps that child and no
// other. A wait for no child in particular would otherwise be free to reap a different one.
static pid_t counted_wait4(pid_t pid, int *status, int options, struct rusage *usage) {
  siginfo_t info;
  memset(&info, 0, sizeof info);
  idtype_t which = pid > 0 ? P_PID : pid == -1 ? P_ALL : P_PGID;
  id_t id = pid > 0 ? (id_t)pid : pid == -1 ? 0 : pid == 0 ? (id_t)getpgrp() : (id_t)-pid;
  int flags = WEXITED | WNOWAIT | (options & WNOHANG) | (options & WUNTRACED ? WSTOPPED : 0) | (options & WCONTINUED ? WCONTINUED : 0);
  if (waitid(which, id, &info, flags)) return -1;
  if (info.si_pid) pid = info.si_pid;
  int exited = info.si_pid && (info.si_code == CLD_EXITED || info.si_code == CLD_KILLED || info.si_code == CLD_DUMPED);
  uint64_t before = child_time();
  int unread = exited && !reaping(pid);
  pid_t reaped = wait4(pid, status, options, usage);
  if (unread && reaped > 0) {
    int saved = errno;
    char line[128];
    put(line, snprintf(line, sizeof line, "unread %d %d %llu\n", getpid(), reaped, child_time() - before));
    errno = saved;
  }
  return reaped;
}
static pid_t counted_waitpid(pid_t pid, int *status, int options) {
  return counted_wait4(pid, status, options, NULL);
}

static pid_t counted_fork(void) {
  pid_t child = fork();
  if (child > 0) started(child, "(forked)");
  return child;
}

// A child nothing waits for has no one to read it, so it reports itself as it exits normally.
__attribute__((destructor)) static void exiting(void) {
  struct rusage_info_v4 usage;
  char line[128];
  if (proc_pid_rusage(getpid(), RUSAGE_INFO_V4, (rusage_info_t *)&usage)) return;
  put(line, snprintf(line, sizeof line, "exit %d %llu %llu\n", getpid(), usage.ri_instructions, usage.ri_child_elapsed_abstime));
}

// This process's own two settings, whole, as a child's environment holds them. A bench or the hub may hand
// a child a clean environment, and the child still has to be followed.
static char log_setting[1100], library_setting[1100];
__attribute__((constructor)) static void keep_settings(void) {
  snprintf(log_setting, sizeof log_setting, LOG "=%s", getenv(LOG) ? getenv(LOG) : "");
  snprintf(library_setting, sizeof library_setting, LIBRARY "=%s", getenv(LIBRARY) ? getenv(LIBRARY) : "");
}

static int holds(char *const envp[], const char *name) {
  for (; *envp; envp++) if (!strncmp(*envp, name, strlen(name)) && (*envp)[strlen(name)] == '=') return 1;
  return 0;
}

// envp with the two settings, or NULL if it can't be built. The caller frees it.
static char **following(char *const envp[]) {
  int count = 0;
  while (envp[count]) count++;
  char **carried = malloc((count + 3) * sizeof *carried);
  if (!carried) return NULL;
  memcpy(carried, envp, count * sizeof *carried);
  if (!holds(envp, LOG)) carried[count++] = log_setting;
  if (!holds(envp, LIBRARY)) carried[count++] = library_setting;
  carried[count] = NULL;
  return carried;
}

// libuv walks PATH by spawning each candidate, and each failed spawn still adds a child the kernel never
// ran to the parent's child time, some of it after the call returns. A path that isn't there gets the same
// answer without one. A relative path is left to the kernel: a file action may change the directory first.
static int counted_posix_spawn(pid_t *pid, const char *path, const posix_spawn_file_actions_t *actions, const posix_spawnattr_t *attributes, char *const argv[], char *const envp[]) {
  pid_t child = 0;
  if (path[0] == '/' && access(path, F_OK) && (errno == ENOENT || errno == ENOTDIR)) return errno;
  char **carried = following(envp);
  int failed = posix_spawn(&child, path, actions, attributes, argv, carried ? carried : envp);
  free(carried);
  if (pid) *pid = child;
  if (!failed && child) started(child, path);
  return failed;
}

// posix_spawnp walks PATH the same way inside libc, as Rust's Command has it do, so the walk happens here.
static int counted_posix_spawnp(pid_t *pid, const char *file, const posix_spawn_file_actions_t *actions, const posix_spawnattr_t *attributes, char *const argv[], char *const envp[]) {
  char path[1280];
  const char *directories = getenv("PATH");
  if (!strchr(file, '/') && directories) {
    for (const char *directory = directories; *directory; directory += strcspn(directory, ":"), directory += *directory == ':') {
      snprintf(path, sizeof path, "%.*s/%s", (int)strcspn(directory, ":"), directory, file);
      if (path[0] == '/' && !access(path, X_OK)) { file = path; break; }
    }
  }
  pid_t child = 0;
  char **carried = following(envp);
  int failed = posix_spawnp(&child, file, actions, attributes, argv, carried ? carried : envp);
  free(carried);
  if (pid) *pid = child;
  if (!failed && child) started(child, file);
  return failed;
}
INTERPOSE(counted_waitpid, waitpid)
INTERPOSE(counted_wait4, wait4)
INTERPOSE(counted_fork, fork)
INTERPOSE(counted_posix_spawn, posix_spawn)
INTERPOSE(counted_posix_spawnp, posix_spawnp)
#endif
