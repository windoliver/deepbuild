// probe: a process "your agent built", as the #236 acceptance tests run it inside the sandbox. It tries each
// operation it is given and writes one JSON line per try to the file after -o (append), so the test reads
// what the sandbox allowed without trusting anything else the process says.
//
//   probe -o <results file> <op> <arg> [<op> <arg> ...] [spawn <program> <args...>]
//
//   read <path>      open for reading and read a byte
//   write <path>     create or truncate, and write "probe\n"
//   tcp <port>       connect to 127.0.0.1:<port> and send "hello from probe\n"
//   unix <path>      connect to the Unix socket at <path> and send the same line
//   print <text>     write <text> and a newline to stdout
//   sleep <ms>       sleep
//   spawn <program> <args...>   the rest of the line: run it as a child, wait, record its exit
//
// A line: {"op":"read","target":"/x","ok":true} or {"op":"read","target":"/x","ok":false,"errno":"EPERM"}.
#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <netinet/in.h>
#include <spawn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <sys/wait.h>
#include <unistd.h>

extern char **environ;
static FILE *out;

static const char *errname(int e) {
  switch (e) {
    case EPERM: return "EPERM";
    case EACCES: return "EACCES";
    case ENOENT: return "ENOENT";
    case ECONNREFUSED: return "ECONNREFUSED";
    case EROFS: return "EROFS";
    default: return strerror(e);
  }
}

static void report(const char *op, const char *target, int ok, int err) {
  if (!out) return;
  fprintf(out, "{\"op\":\"%s\",\"target\":\"%s\",\"ok\":%s", op, target, ok ? "true" : "false");
  if (!ok) fprintf(out, ",\"errno\":\"%s\"", errname(err));
  fprintf(out, "}\n");
  fflush(out);
}

static const char LINE[] = "hello from probe\n";

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
  ssize_t n = write(fd, "probe\n", 6);
  int e = errno;
  close(fd);
  report("write", path, n == 6, e);
}

static void try_tcp(const char *port) {
  int fd = socket(AF_INET, SOCK_STREAM, 0);
  if (fd < 0) { report("tcp", port, 0, errno); return; }
  struct sockaddr_in a;
  memset(&a, 0, sizeof a);
  a.sin_family = AF_INET;
  a.sin_port = htons((unsigned short)atoi(port));
  a.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  if (connect(fd, (struct sockaddr *)&a, sizeof a) < 0) { int e = errno; close(fd); report("tcp", port, 0, e); return; }
  ssize_t n = write(fd, LINE, sizeof LINE - 1);
  int e = errno;
  close(fd);
  report("tcp", port, n > 0, e);
}

static void try_unix(const char *op, const char *path) {
  int fd = socket(AF_UNIX, SOCK_STREAM, 0);
  if (fd < 0) { report(op, path, 0, errno); return; }
  struct sockaddr_un a;
  memset(&a, 0, sizeof a);
  a.sun_family = AF_UNIX;
  strncpy(a.sun_path, path, sizeof a.sun_path - 1);
  if (connect(fd, (struct sockaddr *)&a, sizeof a) < 0) { int e = errno; close(fd); report(op, path, 0, e); return; }
  ssize_t n = write(fd, LINE, sizeof LINE - 1);
  int e = errno;
  usleep(100000);
  close(fd);
  report(op, path, n > 0, e);
}

int main(int argc, char **argv) {
  int i = 1;
  if (argc > 2 && strcmp(argv[1], "-o") == 0) {
    out = fopen(argv[2], "a");
    if (!out) { fprintf(stderr, "probe: can't open %s: %s\n", argv[2], strerror(errno)); }
    i = 3;
  }
  for (; i < argc; i++) {
    const char *op = argv[i];
    if (strcmp(op, "spawn") == 0) {
      pid_t child;
      int rc = posix_spawn(&child, argv[i + 1], NULL, NULL, &argv[i + 1], environ);
      if (rc != 0) { report("spawn", argv[i + 1], 0, rc); return 0; }
      int status = 0;
      waitpid(child, &status, 0);
      report("spawn", argv[i + 1], WIFEXITED(status) && WEXITSTATUS(status) == 0, 0);
      return 0;
    }
    if (i + 1 >= argc) { fprintf(stderr, "probe: %s needs an argument\n", op); return 2; }
    const char *arg = argv[++i];
    if (strcmp(op, "read") == 0) try_read(arg);
    else if (strcmp(op, "write") == 0) try_write(arg);
    else if (strcmp(op, "tcp") == 0) try_tcp(arg);
    else if (strcmp(op, "unix") == 0) try_unix("unix", arg);
    else if (strcmp(op, "print") == 0) { printf("%s\n", arg); fflush(stdout); }
    else if (strcmp(op, "sleep") == 0) usleep((useconds_t)atoi(arg) * 1000);
    else { fprintf(stderr, "probe: unknown op %s\n", op); return 2; }
  }
  return 0;
}
