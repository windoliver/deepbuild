// The benchmarks' reader of a live process (process-reader.mjs): process-reader <pid> prints what the kernel has
// counted so far for the process and for each child it has now, one line each, the process first:
//
//   <pid> <start> <age ns> <instructions> <CPU ns> <wakeups> <footprint> <peak footprint>
//   <pid> -          a child whose reading the kernel refuses
//
// It exits 3 when the kernel refuses the process itself. <start> tells a process from a later one given its PID.
// The wakeups are the interrupt wakeups: those that found the package idle are counted among them. A child that
// has ended is left out, reaped or not. scripts/count-children.c reads a command that ends.
#include <errno.h>
#include <libproc.h>
#include <mach/mach_time.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/resource.h>

// The kernel gives times in its own ticks, which are not nanoseconds on Apple silicon.
static mach_timebase_info_data_t base;
static uint64_t ns(uint64_t ticks) {
  return (uint64_t)((__uint128_t)ticks * base.numer / base.denom);
}

// 0 once the process's line is printed, or why the kernel gave no reading.
static int show(pid_t pid) {
  struct rusage_info_v4 usage;
  if (proc_pid_rusage(pid, RUSAGE_INFO_V4, (rusage_info_t *)&usage)) return errno;
  // One that exited and waits to be reaped still answers: it has ended.
  if (usage.ri_proc_exit_abstime) return ESRCH;
  printf("%d %llu %llu %llu %llu %llu %llu %llu\n", pid, usage.ri_proc_start_abstime, ns(mach_absolute_time() - usage.ri_proc_start_abstime),
    usage.ri_instructions, ns(usage.ri_user_time + usage.ri_system_time), usage.ri_interrupt_wkups, usage.ri_phys_footprint, usage.ri_lifetime_max_phys_footprint);
  return 0;
}

int main(int argc, char **argv) {
  if (argc != 2) return 2;
  char *end;
  errno = 0;
  long pid = strtol(argv[1], &end, 10);
  if (errno || !*argv[1] || *end || pid <= 0 || pid > INT32_MAX) return 2;
  mach_timebase_info(&base);
  if (show((pid_t)pid)) return 3;
  static pid_t children[4096];
  int count = proc_listchildpids((pid_t)pid, children, (int)sizeof children);
  for (int i = 0; i < count; i++) {
    int refused = children[i] > 0 ? show(children[i]) : ESRCH;
    if (refused && refused != ESRCH) printf("%d -\n", children[i]);
  }
  return 0;
}
