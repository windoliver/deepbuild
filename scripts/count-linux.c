// Counts a measured command's instructions retired on Linux, with every process it starts, however each one ends
// (#2960). /usr/bin/time reports no counter here. The kernel's own counter does it: opened on the command's process
// before it execs, with inherit, it follows every child, and each child's count joins it as the child exits.
//
//   run - <command...>: the exit of the command is the exit of the run. Its lines, in the file DEEP_COUNT_LOG names:
//   total <instructions>      the command's and every child's, user space only: a host whose perf_event_paranoid
//                             is 2 lets a process count no more, so the kernel's work for it is in no count here
//   blocked <errno> <perf_event_paranoid>      the kernel refused the counter: the run has no count
//   partial <time counted> <time it ran>      the counter wasn't on the command for all of the time it ran, in ns
//                             (the time it ran is its own clock's, or its user CPU time where that is past it):
//                             another counter took its place, it ran on a core no counter covered, or a process
//                             exec'd a program it may run but not read (or whose interpreter it can't read), which
//                             the kernel stops counting: no count
//   left      a process the command started was still running when it ended, so its count never joined
//
// A CPU whose cores are of two kinds has a counter for each kind, and a counter counts only on its own kind of core:
// the command gets one of each, and the run's count is their sum. Each kind's counter keeps its own enabled time, and
// once the command has children the kinds' enabled times differ (51.6 ms against 287.5 ms for one forked child on an
// aarch64 host, #2960), so neither is the time the command ran: the kernel's software clock of the command's own time,
// followed the same way, is.
//
// The runner is the subreaper of what the command starts, so a process that left the command's group or session is
// still its descendant, and seen when it is still running. The command stays in the runner's process group, so
// what stops the run, as benchmark.mjs's timeout stopping the group, stops the command too.
#define _GNU_SOURCE
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <linux/perf_event.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/resource.h>
#include <sys/syscall.h>
#include <sys/wait.h>
#include <unistd.h>

#define KINDS 16
#define PMUS "/sys/bus/event_source/devices"

static void put(const char *line) {
  const char *path = getenv("DEEP_COUNT_LOG");
  int log = path ? open(path, O_WRONLY | O_APPEND) : -1;
  if (log < 0) return;
  if (write(log, line, strlen(line)) < 0) { /* the run's exit still says how the command ended */ }
  close(log);
}

static int paranoid(void) {
  FILE *f = fopen("/proc/sys/kernel/perf_event_paranoid", "r");
  int level = -99;
  if (f) {
    if (fscanf(f, "%d", &level) != 1) level = -99;
    fclose(f);
  }
  return level;
}

static int counter(struct perf_event_attr *attr, pid_t child) {
  return (int)syscall(SYS_perf_event_open, attr, child, -1, -1, PERF_FLAG_FD_CLOEXEC);
}

// The kernel's types of the counters for each kind of core: a core PMU lists its cpus, other PMUs don't.
static int core_kinds(unsigned types[KINDS]) {
  int kinds = 0;
  DIR *pmus = opendir(PMUS);
  struct dirent *pmu;
  while (pmus && kinds < KINDS && (pmu = readdir(pmus))) {
    char path[512];
    snprintf(path, sizeof path, PMUS "/%.200s/cpus", pmu->d_name);
    if (pmu->d_name[0] == '.' || access(path, R_OK)) continue;
    snprintf(path, sizeof path, PMUS "/%.200s/type", pmu->d_name);
    FILE *f = fopen(path, "r");
    if (!f) continue;
    if (fscanf(f, "%u", &types[kinds]) == 1) kinds++;
    fclose(f);
  }
  if (pmus) closedir(pmus);
  return kinds;
}

int main(int argc, char **argv) {
  if (argc < 3) return 2;
  if (prctl(PR_SET_CHILD_SUBREAPER, 1)) return 127;
  int go[2];
  if (pipe(go)) return 127;
  pid_t child = fork();
  if (child < 0) return 127;
  if (!child) {
    // Waits until the counter is on it, so nothing the command does goes uncounted.
    char ready;
    close(go[1]);
    if (read(go[0], &ready, 1) != 1) _exit(126);
    close(go[0]);
    // No process of the command gains privilege at its exec: a setuid or file-capability program, which the kernel
    // stops counting, runs as the command's own user instead, counted like any other, or fails where it needs more.
    if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0)) _exit(126);
    execvp(argv[2], argv + 2);
    perror(argv[2]);
    _exit(errno == ENOENT ? 127 : 126);
  }
  close(go[0]);
  struct perf_event_attr attr;
  memset(&attr, 0, sizeof attr);
  attr.size = sizeof attr;
  attr.type = PERF_TYPE_HARDWARE;
  attr.read_format = PERF_FORMAT_TOTAL_TIME_ENABLED | PERF_FORMAT_TOTAL_TIME_RUNNING;
  attr.disabled = 1;
  attr.enable_on_exec = 1;
  attr.inherit = 1;
  attr.exclude_kernel = 1;
  attr.exclude_hv = 1;
  // One counter for each kind of core, named by its PMU's type in the config's upper half; a kernel or a CPU without
  // that takes the one counter of every core.
  unsigned types[KINDS];
  int kinds = core_kinds(types), counters[KINDS], opened = 0, refused = 0;
  for (int kind = 0; kind < kinds; kind++) {
    attr.config = PERF_COUNT_HW_INSTRUCTIONS | ((uint64_t)types[kind] << 32);
    int fd = counter(&attr, child);
    if (fd >= 0) counters[opened++] = fd;
    else refused = errno;
  }
  if (!opened) {
    attr.config = PERF_COUNT_HW_INSTRUCTIONS;
    int fd = counter(&attr, child);
    if (fd >= 0) counters[opened++] = fd;
    else refused = errno;
  }
  // The time the command's processes ran while the counters followed them, in ns: the software task clock, opened
  // as they are, which is never displaced and runs on every core.
  int clock = -1;
  if (opened) {
    attr.type = PERF_TYPE_SOFTWARE;
    attr.config = PERF_COUNT_SW_TASK_CLOCK;
    clock = counter(&attr, child);
  }
  char line[160];
  if (opened && clock < 0) {
    refused = errno;
    for (int at = 0; at < opened; at++) close(counters[at]);
    opened = 0;
  }
  if (!opened) {
    int level = paranoid();
    snprintf(line, sizeof line, "blocked %d %d\n", refused, level);
    put(line);
  }
  if (write(go[1], "x", 1) != 1) { /* the child then exits 126 */ }
  close(go[1]);
  // Waits for the command, reaping each orphan of it as it ends (its count joined as it ended), as init would have:
  // one left a zombie would read as running to whatever polls it.
  int status, other;
  for (;;) {
    pid_t ended = waitpid(-1, &other, 0);
    if (ended == child) { status = other; break; }
    if (ended < 0 && errno != EINTR) return 127;
  }
  // What the command left: one still running is a count that never joined.
  for (;;) {
    pid_t ended = waitpid(-1, &other, WNOHANG);
    if (ended > 0 || (ended < 0 && errno == EINTR)) continue;
    if (!ended) put("left\n");
    break;
  }
  // Each kind's counter runs only while a process is on its own kind of core, so their times running together are
  // the time some counter was on the command: short of the command's own time when a counter was displaced, or the
  // command ran on a core none covers. They were equal to the ns in every reading on a 7.0 kernel; a kernel before 6.2
  // keeps hardware and software events in two contexts switched at slightly different instants (not measured), so a
  // shortfall of 1 ms is allowed, as below. Running time past the clock, as two counters covering one core would give,
  // was never seen and isn't checked.
  uint64_t total = 0, running = 0, ran = 0, whole = 1, read_out[3];
  for (int at = 0; at < opened; at++) {
    if (read(counters[at], read_out, sizeof read_out) != sizeof read_out) whole = 0;
    else {
      total += read_out[0];
      running += read_out[2];
    }
    close(counters[at]);
  }
  if (opened) {
    if (read(clock, read_out, sizeof read_out) != sizeof read_out) whole = 0;
    else ran = read_out[0];
    close(clock);
  }
  // The time the command ran while counted, user and kernel time, against the user CPU time of the command and all it
  // started, every one reaped by now: a process the kernel stopped counting at its exec ran longer than the clock saw.
  // Its whole CPU time can't be the bound: the command's own fork to exec and each process's last steps after its
  // count joined lie outside the clock, 0.1 to 0.2 ms a process on that aarch64 host, kernel work that a user-space
  // count leaves out (a program run 50 times counted the same instructions to 83 in 6 M while that gap moved by 0.6
  // ms), and the kernel lets no unprivileged counter count the processes (a ring of fork records can't follow
  // children). So user time more than 1 ms past the time counted is no count.
  // What it can't see: uncounted user work within the kernel time counted, which this lets through. With no new
  // privileges that is only a program a process may run but not read (or whose interpreter it can't read), which the
  // kernel stops counting, and up to 1 ms of a displaced counter or of a core kind whose counter the kernel refused.
  // And IRQ and steal time, and a child the kernel reaps
  // itself, under a parent that ignores SIGCHLD, which adds no CPU time here.
  // What it may null: a fully counted run of many short processes on a kernel that splits CPU time by ticks, which
  // gives a process no tick of kernel time saw all its runtime as user time, the part outside the clock included.
  struct rusage used;
  uint64_t user = getrusage(RUSAGE_CHILDREN, &used) ? UINT64_MAX
    : (uint64_t)used.ru_utime.tv_sec * 1000000000ull + (uint64_t)used.ru_utime.tv_usec * 1000ull;
  if (opened && whole && running + 1000000ull < ran) snprintf(line, sizeof line, "partial %llu %llu\n", (unsigned long long)running, (unsigned long long)ran);
  else if (opened && whole && user > ran + 1000000ull) snprintf(line, sizeof line, "partial %llu %llu\n", (unsigned long long)ran, (unsigned long long)user);
  else if (opened && whole) snprintf(line, sizeof line, "total %llu\n", (unsigned long long)total);
  else if (opened) snprintf(line, sizeof line, "partial %llu %llu\n", (unsigned long long)running, (unsigned long long)ran);
  if (opened) put(line);
  if (!WIFSIGNALED(status)) return WEXITSTATUS(status);
  signal(WTERMSIG(status), SIG_DFL);
  raise(WTERMSIG(status));
  return 128 + WTERMSIG(status);
}
