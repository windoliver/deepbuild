// The supervisor's native helper on macOS (#236), built beside the package's JavaScript by its build script.
//
//   helper scan <marker>...     every process whose Seatbelt profile allows the mach-lookup of a run's marker and
//                               denies the window server's, one line each: "<marker> <pid> <ppid> <pgid>". A profile
//                               is inherited through fork, exec and setsid and can't be dropped, so this finds every
//                               process a run's sandbox holds, whatever its group, parent or environment.
//   helper probe <file> <op> <arg> ...
//                               the seam suite's sandboxed process: tries each operation and appends one JSON line per
//                               try to <file>: read <path>, write <path>, tcp <port> (on 127.0.0.1), unix <path>, and
//                               devices <file>, which runs this helper again, as its child, in `devices` mode.
//   helper devices <file>       what the policy this process runs under says about each device, from sandbox_check()
//                               on itself without reporting: one line each for the camera, the microphone, the audio
//                               output (the audio server's mach-lookup) and a screen capture (the window server's).
#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <libproc.h>
#include <netinet/in.h>
#include <spawn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/proc_info.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <sys/wait.h>
#include <unistd.h>

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
      printf("%s %d %u %u\n", markers[m], pid, info.pbi_ppid, info.pbi_pgid);
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

int main(int argc, char **argv) {
  if (argc >= 2 && strcmp(argv[1], "scan") == 0) return scan(argc - 2, argv + 2);
  if (argc < 3) { fprintf(stderr, "usage: helper scan <marker>... | probe <file> <op> <arg>... | devices <file>\n"); return 2; }
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
