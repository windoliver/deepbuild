// alloc: #3220's fixture run for AC1 (README, The fixture programs), after #1409's planted parent and allocator. Built once
// per test process with `cc` (helpers.ts). It ends itself after two minutes whatever happens, so nothing it starts can
// outlive a test.
//
//   alloc parent <dir> <MiB> <wait ms> <cpu ms> <hold ms>
//       forks itself as its child, waits for it and ends with its status as a shell would (its exit code, or 128 + the
//       signal that ended it); it allocates nothing and does no work itself. The child:
//         - waits <wait ms>, so a scan's first sample of the run comes before any of its memory is allocated;
//         - allocates <MiB> in 1 MiB blocks, writing every 8-byte word with pseudo-random values, so the memory is
//           resident and can't be compressed or shared;
//         - works until its own CPU time (getrusage, user and system) reaches <cpu ms>;
//         - holds what it allocated for <hold ms>;
//         - writes what it reads of itself to <dir>/child.json: {"mib": n, "cpu_s": its own CPU seconds, "pid": p};
//         - prints "allocated <MiB> MiB, sum <hex>" and exits 0.
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/resource.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

#define BLOCK (1024 * 1024)

static double cpu_now(void) {
  struct rusage u;
  getrusage(RUSAGE_SELF, &u);
  return (double)u.ru_utime.tv_sec + u.ru_utime.tv_usec / 1e6 + (double)u.ru_stime.tv_sec + u.ru_stime.tv_usec / 1e6;
}

static void sleep_ms(long ms) {
  struct timespec t = {ms / 1000, (ms % 1000) * 1000000L};
  while (nanosleep(&t, &t) == -1) {
  }
}

static uint64_t next(uint64_t x) {
  x ^= x << 13;
  x ^= x >> 7;
  x ^= x << 17;
  return x;
}

static int child(const char *dir, long mib, long wait, long cpu_ms, long hold) {
  sleep_ms(wait);
  uint64_t **blocks = malloc((size_t)mib * sizeof *blocks);
  if (!blocks) return 3;
  uint64_t x = 88172645463325252ULL ^ (uint64_t)getpid();
  for (long i = 0; i < mib; i++) {
    blocks[i] = malloc(BLOCK);
    if (!blocks[i]) return 3;
    for (size_t j = 0; j < BLOCK / sizeof(uint64_t); j++) blocks[i][j] = x = next(x);
  }
  while (cpu_now() * 1000.0 < (double)cpu_ms)
    for (int k = 0; k < 1000000; k++) x = next(x);
  uint64_t sum = x;
  for (long i = 0; i < mib; i++) sum ^= blocks[i][(size_t)i % (BLOCK / sizeof(uint64_t))];
  sleep_ms(hold);
  double cpu = cpu_now();
  char path[4096];
  snprintf(path, sizeof path, "%s/child.json", dir);
  FILE *f = fopen(path, "w");
  if (!f) return 4;
  fprintf(f, "{\"mib\": %ld, \"cpu_s\": %.6f, \"pid\": %d}\n", mib, cpu, (int)getpid());
  fclose(f);
  printf("allocated %ld MiB, sum %016llx\n", mib, (unsigned long long)sum);
  return 0;
}

int main(int argc, char **argv) {
  if (argc != 7 || strcmp(argv[1], "parent") != 0) {
    fprintf(stderr, "usage: alloc parent <dir> <MiB> <wait ms> <cpu ms> <hold ms>\n");
    return 2;
  }
  alarm(120);
  pid_t pid = fork();
  if (pid < 0) return 5;
  if (pid == 0) return child(argv[2], atol(argv[3]), atol(argv[4]), atol(argv[5]), atol(argv[6]));
  int status = 0;
  while (waitpid(pid, &status, 0) < 0) {
  }
  if (WIFEXITED(status)) return WEXITSTATUS(status);
  return 128 + (WIFSIGNALED(status) ? WTERMSIG(status) : 1);
}
