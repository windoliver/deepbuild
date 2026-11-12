// planted: #1409's planted allocator and writer, and the parent that does nothing itself (the issue's Proof). Built
// once per test process with `cc` (helpers.ts). Every path it is given is absolute. Each mode writes what it saw to
// files in <dir>, never to its output, so a run's output is the same with limits and without: the time it passed a
// mark, a heartbeat, and the file-size limit it runs under. It ends itself after two minutes whatever happens, so
// nothing it starts can outlive a test.
//
//   planted parent <child mode> <arg>...
//       starts this program again as its child, in <child mode>, waits for it and ends with its status as a shell
//       would (its exit code, or 128 + the signal that ended it). It allocates nothing and writes nothing.
//   planted alloc <dir> <total MiB> <mark MiB> <hold ms> <exit code>
//       allocates <total MiB> in 1 MiB blocks, every page written with pseudo-random words, so the memory is resident
//       and can't be compressed or shared; writes <dir>/passed (ms since the epoch) the moment the memory it has
//       written passes <mark MiB>; then holds it all for <hold ms>, and exits <exit code>. While it lives it writes
//       <dir>/beat ("<MiB written> <ms since the epoch>") after each block and every 20 ms while it holds.
//       stdout: "allocated <total> MiB, sum <hex>"; stderr: "alloc: held <hold> ms".
//   planted write <dir> <file> <total MiB> <exit code>
//       writes <total MiB> of pseudo-random bytes to <dir>/<file> in 1 MiB writes, then exits <exit code>; a write that
//       fails ends it with exit code 1, naming the error on stderr.
//       stdout: "wrote <total> MiB, sum <hex>"; stderr: "write: done".
//   Every mode but parent first writes <dir>/fsize: its RLIMIT_FSIZE soft limit in bytes, or "unlimited".
#include <errno.h>
#include <fcntl.h>
#include <inttypes.h>
#include <mach-o/dyld.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/resource.h>
#include <sys/time.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

#define MIB (1024 * 1024)

static int64_t now_ms(void) {
  struct timespec t;
  clock_gettime(CLOCK_REALTIME, &t);
  return (int64_t)t.tv_sec * 1000 + t.tv_nsec / 1000000;
}

/** Writes `text` as the whole of <dir>/<name>, in place, so a reader never sees it empty for long. */
static void note(const char *dir, const char *name, const char *text) {
  char path[1024];
  snprintf(path, sizeof path, "%s/%s", dir, name);
  int fd = open(path, O_WRONLY | O_CREAT, 0644);
  if (fd < 0) return;
  size_t n = strlen(text);
  if (pwrite(fd, text, n, 0) == (ssize_t)n) ftruncate(fd, (off_t)n);
  close(fd);
}
static void stamp(const char *dir, const char *name) {
  char text[32];
  snprintf(text, sizeof text, "%" PRId64 "\n", now_ms());
  note(dir, name, text);
}
/** The heartbeat: "<MiB written so far> <ms since the epoch>". */
static void beat(const char *dir, long mib) {
  char text[64];
  snprintf(text, sizeof text, "%ld %" PRId64 "\n", mib, now_ms());
  note(dir, "beat", text);
}
static void fsize(const char *dir) {
  struct rlimit r;
  char text[64];
  if (getrlimit(RLIMIT_FSIZE, &r) != 0) snprintf(text, sizeof text, "error %d\n", errno);
  else if (r.rlim_cur == RLIM_INFINITY) snprintf(text, sizeof text, "unlimited\n");
  else snprintf(text, sizeof text, "%" PRIu64 "\n", (uint64_t)r.rlim_cur);
  note(dir, "fsize", text);
}

static uint64_t state = 0x9E3779B97F4A7C15ULL;
static uint64_t next(void) {
  state ^= state << 13;
  state ^= state >> 7;
  state ^= state << 17;
  return state;
}

static int parent(int argc, char **argv, const char *self) {
  pid_t child = fork();
  if (child < 0) return 126;
  if (child == 0) {
    char **args = calloc((size_t)argc + 2, sizeof(char *));
    args[0] = (char *)self;
    for (int i = 0; i < argc; i++) args[i + 1] = argv[i];
    execv(self, args);
    _exit(127);
  }
  int status;
  while (waitpid(child, &status, 0) < 0) if (errno != EINTR) return 126;
  if (WIFEXITED(status)) return WEXITSTATUS(status);
  return 128 + WTERMSIG(status);
}

static int alloc(const char *dir, long total, long mark, long hold, int code) {
  fsize(dir);
  uint64_t sum = 0;
  int passed = 0;
  for (long i = 0; i < total; i++) {
    uint64_t *block = malloc(MIB);
    if (!block) { fprintf(stderr, "alloc: out of memory at %ld MiB\n", i); return 1; }
    for (size_t w = 0; w < MIB / sizeof(uint64_t); w++) block[w] = next();
    sum ^= block[i % (MIB / sizeof(uint64_t))];
    if (!passed && i + 1 > mark) { stamp(dir, "passed"); passed = 1; }
    beat(dir, i + 1);
  }
  printf("allocated %ld MiB, sum %016" PRIx64 "\n", total, sum);
  fflush(stdout);
  for (int64_t until = now_ms() + hold; now_ms() < until;) {
    beat(dir, total);
    usleep(20 * 1000);
  }
  fprintf(stderr, "alloc: held %ld ms\n", hold);
  return code;
}

static int writer(const char *dir, const char *file, long total, int code) {
  fsize(dir);
  char path[1024];
  snprintf(path, sizeof path, "%s/%s", dir, file);
  int fd = open(path, O_WRONLY | O_CREAT | O_TRUNC, 0644);
  if (fd < 0) { fprintf(stderr, "write: open %s: %s\n", file, strerror(errno)); return 1; }
  uint64_t *block = malloc(MIB);
  uint64_t sum = 0;
  for (long i = 0; i < total; i++) {
    for (size_t w = 0; w < MIB / sizeof(uint64_t); w++) block[w] = next();
    sum ^= block[0];
    for (size_t done = 0; done < MIB;) {
      ssize_t n = write(fd, (char *)block + done, MIB - done);
      if (n < 0) { fprintf(stderr, "write: %s at %ld MiB\n", strerror(errno), i); return 1; }
      done += (size_t)n;
    }
  }
  close(fd);
  printf("wrote %ld MiB, sum %016" PRIx64 "\n", total, sum);
  fflush(stdout);
  fprintf(stderr, "write: done\n");
  return code;
}

int main(int argc, char **argv) {
  alarm(120);
  if (argc >= 3 && strcmp(argv[1], "parent") == 0) {
    // Its own file, whatever a wrapper put in argv[0].
    char self[4096];
    uint32_t size = sizeof self;
    return parent(argc - 2, argv + 2, _NSGetExecutablePath(self, &size) == 0 ? self : argv[0]);
  }
  if (argc == 7 && strcmp(argv[1], "alloc") == 0) return alloc(argv[2], atol(argv[3]), atol(argv[4]), atol(argv[5]), atoi(argv[6]));
  if (argc == 6 && strcmp(argv[1], "write") == 0) return writer(argv[2], argv[3], atol(argv[4]), atoi(argv[5]));
  fprintf(stderr, "usage: planted parent <mode> <arg>... | alloc <dir> <MiB> <mark MiB> <hold ms> <code> | write <dir> <file> <MiB> <code>\n");
  return 2;
}
