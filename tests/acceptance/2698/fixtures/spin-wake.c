// AC1's fixture: a process that spins for 100 ms, sleeps, and wakes 10 times a second for 10 s.
//
//   spin-wake calibrate                     prints the loops this machine spins in 100 ms of CPU time, and exits
//   spin-wake <loops> <wakes> <period ms>   prints {"ready":…}, waits for a line, spins <loops>, then sleeps <period>
//                                           and wakes, <wakes> times, prints {"done":…}, and waits for a line to exit
//
// The spin is a fixed number of loops, so every run retires the same instructions whatever core or load it gets; the
// test sizes it once, by `calibrate`, to 100 ms. Each sleep blocks the process until a timer wakes it: one wakeup.
// The "done" line is the test's oracle: the sleeps it woke from, and its own CPU time over the work by getrusage.
// `kernel` is what the kernel counted for this process over the same work, for the test's preconditions.
#include "common.h"

int main(int argc, char **argv) {
  alarm(WATCHDOG);
  if (argc == 2 && !strcmp(argv[1], "calibrate")) {
    printf("{\"loops\":%llu}\n", calibrate(100));
    return 0;
  }
  if (argc != 4) return 2;
  uint64_t loops = strtoull(argv[1], NULL, 10);
  long wakes = strtol(argv[2], NULL, 10), period = strtol(argv[3], NULL, 10);
  if (!loops || wakes <= 0 || period <= 0) return 2;
  printf("{\"ready\":true,\"pid\":%d}\n", getpid());
  fflush(stdout);
  await_line();
  uint64_t instructions[2], interrupts[2], idles[2];
  own_counts(&instructions[0], &interrupts[0], &idles[0]);
  uint64_t cpu = cpu_us(), wall = wall_us();
  spin(loops);
  uint64_t spun = cpu_us() - cpu;
  long woke = 0;
  for (; woke < wakes; woke++) nap(period);
  cpu = cpu_us() - cpu;
  wall = wall_us() - wall;
  own_counts(&instructions[1], &interrupts[1], &idles[1]);
  printf("{\"done\":true,\"wakes\":%ld,\"cpuMs\":%.3f,\"spinCpuMs\":%.3f,\"elapsedMs\":%.1f,\"kernel\":{\"instructions\":%llu,\"interruptWakeups\":%llu,\"idleWakeups\":%llu}}\n",
    woke, cpu / 1000.0, spun / 1000.0, wall / 1000.0, instructions[1] - instructions[0], interrupts[1] - interrupts[0], idles[1] - idles[0]);
  fflush(stdout);
  await_line();
  return 0;
}
