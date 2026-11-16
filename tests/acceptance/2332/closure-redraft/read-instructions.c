// Prints the instructions retired of one live process, as scripts/count-children.c reads a reaped one:
// proc_pid_rusage(pid, RUSAGE_INFO_V4).ri_instructions. That field is the process alone, threads included
// and children apart. Exit 1 with nothing printed when the kernel denies the read: a missing count is never 0.
#include <libproc.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/resource.h>

int main(int argc, char **argv) {
  struct rusage_info_v4 usage;
  if (argc != 2 || atoi(argv[1]) <= 0) return 2;
  if (proc_pid_rusage(atoi(argv[1]), RUSAGE_INFO_V4, (rusage_info_t *)&usage)) return 1;
  printf("%llu\n", usage.ri_instructions);
  return 0;
}
