// Reads, for each pid on a line of stdin, that live process's own instructions retired (the counter the perf
// lane's scripts/count-children.c reads: proc_pid_rusage RUSAGE_INFO_V4 ri_instructions; children are not in it).
// Prints one number per line; 0 when the kernel gives no count. Measurement tooling only: both sides use this build.
#include <libproc.h>
#include <stdio.h>
#include <stdlib.h>
int main(void) {
  char line[64];
  while (fgets(line, sizeof line, stdin)) {
    struct rusage_info_v4 usage;
    int pid = atoi(line);
    unsigned long long count = pid > 0 && !proc_pid_rusage(pid, RUSAGE_INFO_V4, (rusage_info_t *)&usage) ? usage.ri_instructions : 0;
    printf("%llu\n", count);
    fflush(stdout);
  }
  return 0;
}
