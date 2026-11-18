// The suite's own look at a live process, apart from the reader under test: probe <pid> prints one JSON line of
// what the kernel has counted for it so far and the PIDs of its children. It exits 3, with the kernel's reason on
// stderr, when the kernel refuses the reading. The tests use it to check their preconditions (a process the kernel
// refuses, a profile that refuses) and the planted readers are built on it, each wrong in one way.
#include <errno.h>
#include <libproc.h>
#include <mach/mach_time.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/resource.h>

int main(int argc, char **argv) {
  if (argc != 2) return 2;
  char *end;
  errno = 0;
  long pid = strtol(argv[1], &end, 10);
  if (errno || !*argv[1] || *end || pid <= 0 || pid > INT32_MAX) return 2;
  struct rusage_info_v4 usage;
  if (proc_pid_rusage((pid_t)pid, RUSAGE_INFO_V4, (rusage_info_t *)&usage)) {
    fprintf(stderr, "proc_pid_rusage(%ld): %s\n", pid, strerror(errno));
    return 3;
  }
  // The kernel gives CPU time in its own ticks, which are not nanoseconds on Apple silicon.
  mach_timebase_info_data_t base;
  mach_timebase_info(&base);
  long double ns = (long double)(usage.ri_user_time + usage.ri_system_time) * base.numer / base.denom;
  printf("{\"pid\":%ld,\"instructions\":%llu,\"cpuNs\":%.0Lf,\"wakeups\":%llu,\"idleWakeups\":%llu,\"footprintBytes\":%llu,\"residentBytes\":%llu,\"children\":[",
    pid, usage.ri_instructions, ns, usage.ri_interrupt_wkups, usage.ri_pkg_idle_wkups, usage.ri_phys_footprint, usage.ri_resident_size);
  static pid_t children[4096];
  memset(children, 0, sizeof children);
  proc_listchildpids((pid_t)pid, children, (int)sizeof children);
  int first = 1;
  for (size_t i = 0; i < sizeof children / sizeof *children; i++) {
    if (children[i] <= 0) continue;
    printf("%s%d", first ? "" : ",", children[i]);
    first = 0;
  }
  printf("]}\n");
  return 0;
}
