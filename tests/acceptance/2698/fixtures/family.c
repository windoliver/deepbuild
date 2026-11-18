// AC3's fixture: a parent, a child it starts and keeps, and a child that ends.
//
//   family <loops>   <loops> is what this machine spins in 100 ms (spin-wake calibrate). It starts both children, which
//                    wait; prints {"ready":…} with the three PIDs and waits for a line; then all three work at once;
//                    it reaps the child that ends, prints {"done":…}, and waits for a line, on which it ends the kept
//                    child, reaps it and exits
//
// Each process's work is memory it writes and keeps, then a fixed spin cut into slices with a timed sleep after each:
//
//   parent   64 MB,  50 ms of spin, 10 sleeps of 100 ms
//   kept    128 MB, 100 ms of spin, 30 sleeps of 100 ms, then it stays
//   ended    96 MB, 300 ms of spin, 60 sleeps of 50 ms, then it exits and the parent reaps it
//
// The ended child does twice the kept pair's CPU work and 1.5 times their sleeps, so a reader that counts it twice
// lands far outside any sum that counts it once. The "done" line is the test's oracle: for each process the bytes it
// holds, the sleeps it woke from, its own CPU time by getrusage (the ended child's whole life, by wait4), and the
// instructions the kernel counted for it over its work. `kernelWakeups` is what the kernel counted for those sleeps,
// for the test's precondition.
#include "common.h"
#include <sys/wait.h>

struct job { size_t bytes; uint64_t loops; long wakes, period; };
struct did { uint64_t cpu, instructions, wakeups; size_t bytes; };

static size_t pages(size_t bytes) {
  size_t page = (size_t)getpagesize();
  return (bytes + page - 1) / page * page;
}

static struct did work(const struct job *job) {
  struct did did = { cpu_us(), 0, 0, pages(job->bytes) };
  uint64_t before, after, woke, unused;
  own_counts(&before, &did.wakeups, &unused);
  if (!hold(did.bytes)) _exit(4);
  for (long i = 0; i < job->wakes; i++) {
    spin(job->loops / (uint64_t)job->wakes);
    nap(job->period);
  }
  own_counts(&after, &woke, &unused);
  did.instructions = after - before;
  did.wakeups = woke - did.wakeups;
  did.cpu = cpu_us() - did.cpu;
  return did;
}

// A child that waits for a byte, works, reports, and then exits, or stays until a second byte or its parent's end.
static pid_t start(const struct job *job, int stays, int *go, int *report) {
  int to[2], from[2];
  if (pipe(to) || pipe(from)) exit(4);
  pid_t pid = fork();
  if (pid < 0) exit(4);
  if (pid == 0) {
    alarm(WATCHDOG);
    close(to[1]);
    close(from[0]);
    char byte;
    if (read(to[0], &byte, 1) != 1) _exit(0);
    struct did did = work(job);
    if (write(from[1], &did, sizeof did) != sizeof did) _exit(4);
    close(from[1]);
    if (stays) (void)!read(to[0], &byte, 1);
    _exit(0);
  }
  close(to[0]);
  close(from[1]);
  *go = to[1];
  *report = from[0];
  return pid;
}

static void show(const char *name, pid_t pid, const struct job *job, const struct did *did, uint64_t cpu) {
  printf("\"%s\":{\"pid\":%d,\"heldBytes\":%zu,\"wakes\":%ld,\"cpuMs\":%.3f,\"instructions\":%llu,\"kernelWakeups\":%llu}", name, pid, did->bytes, job->wakes, cpu / 1000.0, did->instructions, did->wakeups);
}

int main(int argc, char **argv) {
  alarm(WATCHDOG);
  if (argc != 2) return 2;
  uint64_t unit = strtoull(argv[1], NULL, 10);
  if (!unit) return 2;
  const struct job mine = { 64000000, unit / 2, 10, 100 }, keeps = { 128000000, unit, 30, 100 }, ends = { 96000000, unit * 3, 60, 50 };
  int kept_go, kept_report, ended_go, ended_report;
  pid_t kept = start(&keeps, 1, &kept_go, &kept_report);
  pid_t ended = start(&ends, 0, &ended_go, &ended_report);
  printf("{\"ready\":true,\"pid\":%d,\"kept\":%d,\"ended\":%d}\n", getpid(), kept, ended);
  fflush(stdout);
  await_line();
  uint64_t cpu = cpu_us();
  if (write(kept_go, "g", 1) != 1 || write(ended_go, "g", 1) != 1) return 4;
  struct did parent = work(&mine), child, gone;
  struct rusage life;
  int status;
  if (read(ended_report, &gone, sizeof gone) != sizeof gone) return 4;
  if (wait4(ended, &status, 0, &life) != ended) return 4;
  if (read(kept_report, &child, sizeof child) != sizeof child) return 4;
  cpu = cpu_us() - cpu;
  printf("{\"done\":true,");
  show("parent", getpid(), &mine, &parent, cpu);
  printf(",");
  show("kept", kept, &keeps, &child, child.cpu);
  printf(",");
  show("ended", ended, &ends, &gone, (uint64_t)(life.ru_utime.tv_sec + life.ru_stime.tv_sec) * 1000000ULL + (uint64_t)(life.ru_utime.tv_usec + life.ru_stime.tv_usec));
  printf("}\n");
  fflush(stdout);
  await_line();
  (void)!write(kept_go, "x", 1);
  close(kept_go);
  waitpid(kept, &status, 0);
  return 0;
}
