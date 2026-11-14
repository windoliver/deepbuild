// The supervisor's native helper on macOS (#236), built beside the package's JavaScript by its build script.
//
//   helper scan <marker>...     every process whose Seatbelt profile allows the mach-lookup of a run's marker and
//                               denies the window server's, one line each: "<marker> <pid> <ppid> <pgid> <bytes>",
//                               <bytes> its physical footprint, the memory macOS charges it (#1409). A profile
//                               is inherited through fork, exec and setsid and can't be dropped, so this finds every
//                               process a run's sandbox holds, whatever its group, parent or environment.
//   helper limit <bytes> <program> [<arg>...]
//                               execs <program> with RLIMIT_FSIZE at <bytes> (#1409): `ulimit -f` in bytes, where a
//                               shell's counts blocks of 1024 bytes in macOS's bash 3.2 and of 512 in dash and zsh.
//   helper watch                follows processes to their ends (#1409): each line "<pid>" on its input names one, and
//                               it follows that one and every process it forks, through kqueue, writing
//                               "exit <root> <pid> <status>" as each ends, <status> as wait(2) gives it, <root> the
//                               pid it was named by. "sync <n>" is echoed once every end that came before it is written.
//   helper leash <program> [<arg>...]
//                               execs <program> with a watcher forked beside it, which ends the program once the
//                               process that started this helper is gone, however it went: for a child that writes
//                               nothing for hours, so no closed pipe ever tells it its reader has gone.
//   helper probe <file> <op> <arg> ...
//                               the seam suite's sandboxed process: tries each operation and appends one JSON line per
//                               try to <file>: read <path>, write <path>, tcp <port> (on 127.0.0.1), unix <path>, and
//                               devices <file>, which runs this helper again, as its child, in `devices` mode.
//   helper devices <file>       what the policy this process runs under says about each device, from sandbox_check()
//                               on itself without reporting: one line each for the camera, the microphone, the audio
//                               output (the audio server's mach-lookup) and a screen capture (the window server's).
//   helper pty <dir> <cols> <rows> <protocol> <lock> <plants> <program> [<arg>...]
//                               a hosted terminal's host process (#104, #989), in pty.c, which the Linux helper
//                               shares.
#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <libproc.h>
#include <limits.h>
#include <netinet/in.h>
#include <signal.h>
#include <spawn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <sys/ioctl.h>
#include <sys/event.h>
#include <sys/proc_info.h>
#include <sys/resource.h>
#include <sys/select.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/time.h>
#include <sys/un.h>
#include <sys/wait.h>
#include <unistd.h>
#include <util.h>

extern char **environ;
extern int sandbox_check(pid_t pid, const char *operation, int type, ...);
enum { FILTER_NONE = 0, FILTER_GLOBAL_NAME = 2, NO_REPORT = 0x40000000 };
static const char WINDOW_SERVER[] = "com.apple.windowserver.active";
static const char AUDIO_SERVER[] = "com.apple.audio.audiohald";

static int scan(int count, char **markers) {
  int n = proc_listallpids(NULL, 0);
  if (n <= 0) return 1;
  size_t room = (size_t)n + 256;
  pid_t *pids = calloc(room, sizeof(pid_t));
  if (!pids) return 1;
  n = proc_listallpids(pids, (int)(room * sizeof(pid_t)));
  for (int i = 0; i < n; i++) {
    pid_t pid = pids[i];
    if (pid <= 1) continue;
    // An unsandboxed process allows every lookup; every run's profile denies the window server's.
    if (sandbox_check(pid, "mach-lookup", FILTER_GLOBAL_NAME | NO_REPORT, WINDOW_SERVER) == 0) continue;
    for (int m = 0; m < count; m++) {
      if (sandbox_check(pid, "mach-lookup", FILTER_GLOBAL_NAME | NO_REPORT, markers[m]) != 0) continue;
      struct proc_bsdinfo info;
      if (proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, sizeof info) != (int)sizeof info) continue;
      struct rusage_info_v0 usage;
      unsigned long long bytes = proc_pid_rusage(pid, RUSAGE_INFO_V0, (rusage_info_t *)&usage) == 0 ? usage.ri_phys_footprint : 0;
      printf("%s %d %u %u %llu\n", markers[m], pid, info.pbi_ppid, info.pbi_pgid, bytes);
    }
  }
  free(pids);
  return 0;
}

static FILE *out;

static void report(const char *op, const char *target, int ok, int err) {
  fprintf(out, "{\"op\":\"%s\",\"target\":\"%s\",\"ok\":%s,\"errno\":\"%s\"}\n", op, target, ok ? "true" : "false",
          ok ? "" : err == EPERM ? "EPERM" : err == EACCES ? "EACCES" : strerror(err));
  fflush(out);
}

static void try_read(const char *path) {
  int fd = open(path, O_RDONLY);
  if (fd < 0) { report("read", path, 0, errno); return; }
  char c;
  ssize_t n = read(fd, &c, 1);
  int e = errno;
  close(fd);
  report("read", path, n >= 0, e);
}

static void try_write(const char *path) {
  int fd = open(path, O_WRONLY | O_CREAT | O_TRUNC, 0644);
  if (fd < 0) { report("write", path, 0, errno); return; }
  ssize_t n = write(fd, "x\n", 2);
  int e = errno;
  close(fd);
  report("write", path, n == 2, e);
}

static void try_connect(const char *op, const char *target) {
  int unix = strcmp(op, "unix") == 0;
  int fd = socket(unix ? AF_UNIX : AF_INET, SOCK_STREAM, 0);
  if (fd < 0) { report(op, target, 0, errno); return; }
  int rc;
  if (unix) {
    struct sockaddr_un a;
    memset(&a, 0, sizeof a);
    a.sun_family = AF_UNIX;
    strncpy(a.sun_path, target, sizeof a.sun_path - 1);
    rc = connect(fd, (struct sockaddr *)&a, sizeof a);
  } else {
    struct sockaddr_in a;
    memset(&a, 0, sizeof a);
    a.sin_family = AF_INET;
    a.sin_port = htons((unsigned short)atoi(target));
    a.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    rc = connect(fd, (struct sockaddr *)&a, sizeof a);
  }
  int e = errno;
  close(fd);
  report(op, target, rc == 0, e);
}

static void try_devices(const char *self, const char *file) {
  char *args[] = { (char *)self, "devices", (char *)file, NULL };
  pid_t child;
  int rc = posix_spawn(&child, self, NULL, NULL, args, environ);
  if (rc != 0) { report("devices", file, 0, rc); return; }
  int status = 0;
  waitpid(child, &status, 0);
  report("devices", file, WIFEXITED(status) && WEXITSTATUS(status) == 0, 0);
}

static int denied(const char *operation, const char *name) {
  pid_t self = getpid();
  return name ? sandbox_check(self, operation, FILTER_GLOBAL_NAME | NO_REPORT, name) != 0
              : sandbox_check(self, operation, FILTER_NONE | NO_REPORT) != 0;
}

static int devices(void) {
  const char *names[] = { "camera", "microphone", "audio-output", "screen-capture" };
  int verdicts[] = { denied("device-camera", NULL), denied("device-microphone", NULL), denied("mach-lookup", AUDIO_SERVER),
                     denied("mach-lookup", WINDOW_SERVER) };
  for (int i = 0; i < 4; i++) fprintf(out, "{\"device\":\"%s\",\"sandbox\":\"%s\"}\n", names[i], verdicts[i] ? "deny" : "allow");
  return 0;
}

// ---- limit and watch (#1409).

static int limit(const char *bytes, char **argv) {
  char *end;
  unsigned long long n = strtoull(bytes, &end, 10);
  struct rlimit fsize = { (rlim_t)n, (rlim_t)n };
  if (*end || setrlimit(RLIMIT_FSIZE, &fsize) != 0) { perror("helper limit"); return 2; }
  execvp(argv[0], argv);
  perror(argv[0]);
  return 127;
}

// A process mid-exec can't be found yet (ESRCH), so one that can't be followed is tried again until RETRY_MS pass.
enum { PENDING = 256, RETRY_MS = 200 };
static int kq;
static struct pending { pid_t pid, root; long long until; } pending[PENDING];
static int npending;

static long long now_ms(void) {
  struct timeval tv;
  gettimeofday(&tv, NULL);
  return (long long)tv.tv_sec * 1000 + tv.tv_usec / 1000;
}

static int attach(pid_t pid, pid_t root) {
  struct kevent ev;
  EV_SET(&ev, pid, EVFILT_PROC, EV_ADD | EV_CLEAR, NOTE_EXIT | NOTE_EXITSTATUS | NOTE_FORK, 0, (void *)(intptr_t)root);
  return kevent(kq, &ev, 1, NULL, 0, NULL);
}

static void follow(pid_t pid, pid_t root);
// What `pid` has forked so far; its later forks are followed as NOTE_FORK reports them.
static void children(pid_t pid, pid_t root) {
  pid_t kids[1024];
  int n = proc_listchildpids(pid, kids, (int)sizeof kids);
  for (int i = 0; i < n && i < 1024; i++) if (kids[i] > 1) follow(kids[i], root);
}

static void follow(pid_t pid, pid_t root) {
  if (attach(pid, root) == 0) children(pid, root);
  else if (errno == ESRCH && npending < PENDING) pending[npending++] = (struct pending){ pid, root, now_ms() + RETRY_MS };
}

static int watch(void) {
  kq = kqueue();
  struct kevent in;
  EV_SET(&in, 0, EVFILT_READ, EV_ADD, 0, 0, NULL);
  if (kq < 0 || kevent(kq, &in, 1, NULL, 0, NULL) != 0) return 1;
  setvbuf(stdout, NULL, _IOLBF, 0);
  char line[4096];
  size_t have = 0;
  for (;;) {
    struct kevent got[64];
    struct timespec tick = { 0, 1000000 };
    int n = kevent(kq, NULL, 0, got, 64, npending ? &tick : NULL);
    if (n < 0 && errno != EINTR) return 1;
    // Ends first: any that came before a "sync" in the same batch is written before its echo.
    for (int i = 0; i < n; i++) {
      if (got[i].filter != EVFILT_PROC) continue;
      pid_t pid = (pid_t)got[i].ident, root = (pid_t)(intptr_t)got[i].udata;
      if (got[i].fflags & NOTE_FORK) children(pid, root);
      if (got[i].fflags & NOTE_EXIT) printf("exit %d %d %d\n", root, pid, (int)got[i].data);
    }
    for (int i = 0; i < npending;) {
      struct pending p = pending[i];
      if (attach(p.pid, p.root) == 0) { pending[i] = pending[--npending]; children(p.pid, p.root); continue; }
      if (errno != ESRCH || now_ms() >= p.until) { pending[i] = pending[--npending]; continue; }
      i++;
    }
    for (int i = 0; i < n; i++) {
      if (got[i].filter != EVFILT_READ) continue;
      ssize_t r = read(0, line + have, sizeof line - have - 1);
      if (r <= 0) return 0;
      have += (size_t)r;
      char *nl;
      while ((nl = memchr(line, '\n', have))) {
        *nl = 0;
        if (strncmp(line, "sync ", 5) == 0) printf("%s\n", line);
        else if (atoi(line) > 1) follow(atoi(line), atoi(line));
        size_t used = (size_t)(nl - line) + 1;
        memmove(line, nl + 1, have - used);
        have -= used;
      }
    }
  }
}

// ---- leash.

static int leash(char **argv) {
  pid_t owner = getppid(), program = getpid();
  pid_t watcher = fork();
  if (watcher < 0) { perror("helper leash"); return 2; }
  if (watcher == 0) {
    // Nothing of the program's is held: its output pipe stays the program's alone.
    for (int fd = 0; fd < 256; fd++) close(fd);
    int q = kqueue();
    struct kevent on, got;
    EV_SET(&on, owner, EVFILT_PROC, EV_ADD, NOTE_EXIT, 0, NULL);
    // An owner already gone can't be followed, so the program ends now.
    if (q < 0 || owner <= 1 || kevent(q, &on, 1, NULL, 0, NULL) != 0) { kill(program, SIGTERM); _exit(0); }
    EV_SET(&on, program, EVFILT_PROC, EV_ADD, NOTE_EXIT, 0, NULL);
    if (kevent(q, &on, 1, NULL, 0, NULL) != 0) _exit(0);
    int n;
    while ((n = kevent(q, NULL, 0, &got, 1, NULL)) < 0 && errno == EINTR) {}
    if (n == 1 && (pid_t)got.ident == owner) kill(program, SIGTERM);
    _exit(0);
  }
  execvp(argv[0], argv);
  perror(argv[0]);
  return 127;
}

#include "pty.c"

int main(int argc, char **argv) {
  if (argc >= 2 && strcmp(argv[1], "scan") == 0) return scan(argc - 2, argv + 2);
  if (argc >= 4 && strcmp(argv[1], "limit") == 0) return limit(argv[2], argv + 3);
  if (argc == 2 && strcmp(argv[1], "watch") == 0) return watch();
  if (argc >= 3 && strcmp(argv[1], "leash") == 0) return leash(argv + 2);
  if (argc >= 9 && strcmp(argv[1], "pty") == 0) return host(argv[2], atoi(argv[3]), atoi(argv[4]), atoi(argv[5]), argv[6], argv[7], argv + 8);
  if (argc < 3) { fprintf(stderr, "usage: helper scan <marker>... | limit <bytes> <program> [<arg>...] | watch | leash <program> [<arg>...] | probe <file> <op> <arg>... | devices <file> | pty <dir> <cols> <rows> <protocol> <lock> <plants> <program> [<arg>...]\n"); return 2; }
  out = fopen(argv[2], "a");
  if (!out) { perror(argv[2]); return 2; }
  if (strcmp(argv[1], "devices") == 0) return devices();
  if (strcmp(argv[1], "probe") != 0) return 2;
  for (int i = 3; i + 1 < argc; i += 2) {
    const char *op = argv[i], *arg = argv[i + 1];
    if (strcmp(op, "read") == 0) try_read(arg);
    else if (strcmp(op, "write") == 0) try_write(arg);
    else if (strcmp(op, "tcp") == 0 || strcmp(op, "unix") == 0) try_connect(op, arg);
    else if (strcmp(op, "devices") == 0) try_devices(argv[0], arg);
    else { fprintf(stderr, "helper: unknown op %s\n", op); return 2; }
  }
  return 0;
}
