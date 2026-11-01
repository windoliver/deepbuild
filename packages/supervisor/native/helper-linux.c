// The supervisor's native helper on Linux (#70), built beside the package's JavaScript by its build script. The
// macOS helper is native/helper.c; this one answers the same calls on Linux, where the sandbox is bubblewrap's
// namespaces, Landlock for files and seccomp for sockets (src/bubblewrap.ts).
//
//   helper scan <marker>...     every process whose root holds the run's marker directory, /run/deep/<marker>, which
//                               bubblewrap makes in the run's own mount namespace and no fork, exec, setsid or empty
//                               environment sheds: one line each, "<marker> <pid> <ppid> <pgid>".
//   helper probe <file> <op> <arg> ...
//                               the seam suite's sandboxed process: tries each operation and appends one JSON line per
//                               try to <file>: read <path>, write <path>, tcp <port> (on 127.0.0.1), unix <path>, and
//                               devices <file>, which runs this helper again, as its child, in `devices` mode.
//   helper devices <file>       whether this process can open each device: the camera (/dev/video0), the microphone and
//                               the audio output (the ALSA control, /dev/snd/controlC0) and a screen capture (the
//                               display's /dev/dri/card0); one line each, allow or deny.
//   helper landlock             the kernel's Landlock ABI version on one line, 0 when it has none.
//   helper confine              runs inside bubblewrap as the run's first process, its grant and program read from the
//                               DEEP_CONFINE variable (unit-separated: [--log-fd N] [--as-you] [--read P] [--write P]
//                               [--socket P] [--connect PORT|any] [--listen PORT] [--guard P [--except E]...]
//                               [--plant-writes] -- <program> [<arg>...]), so neither bwrap's nor this process's command
//                               line repeats the program's: it forks the program with Landlock
//                               and a seccomp filter from the grant, and stays as its parent to answer the filter's
//                               notifications: a connect or bind is checked against the grant and made on the program's
//                               own socket, a rename, mode, owner, time or attribute change is checked and made by this
//                               process, and a write Landlock would refuse is refused here first and written to
//                               --log-fd as {"operation","target"}, which the supervisor records as sandbox.denied; the
//                               program's own end goes there too, as {"exit","signal"}. It ends with the program's
//                               status once nothing of the run's is left running (it reaps what the run leaves).
#define _GNU_SOURCE
#include <arpa/inet.h>
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/landlock.h>
#include <linux/netlink.h>
#include <linux/openat2.h>
#include <linux/seccomp.h>
#include <netinet/in.h>
#include <poll.h>
#include <signal.h>
#include <spawn.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/prctl.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/uio.h>
#include <sys/un.h>
#include <sys/wait.h>
#include <sys/xattr.h>
#include <unistd.h>

extern char **environ;

#if defined(__aarch64__)
#define ARCH_NR AUDIT_ARCH_AARCH64
#elif defined(__x86_64__)
#define ARCH_NR AUDIT_ARCH_X86_64
#else
#error "the Linux helper knows aarch64 and x86_64"
#endif

// ---- scan: the processes whose root holds a run's marker.

static int scan(int count, char **markers) {
  DIR *proc = opendir("/proc");
  if (!proc) return 1;
  pid_t self = getpid();
  struct dirent *e;
  while ((e = readdir(proc))) {
    char *end;
    long pid = strtol(e->d_name, &end, 10);
    if (*end || pid <= 1 || pid == self) continue;
    for (int m = 0; m < count; m++) {
      char path[PATH_MAX];
      snprintf(path, sizeof path, "/proc/%ld/root/run/deep/%s", pid, markers[m]);
      if (access(path, F_OK) != 0) continue;
      snprintf(path, sizeof path, "/proc/%ld/stat", pid);
      FILE *stat = fopen(path, "r");
      if (!stat) continue;
      static char line[4096];
      char *got = fgets(line, sizeof line, stat);
      fclose(stat);
      // "pid (comm) state ppid pgrp ...": the comm may hold spaces and parentheses, so read past its last ')'.
      char *close = got ? strrchr(got, ')') : NULL;
      int ppid = 0, pgid = 0;
      if (close && sscanf(close + 1, " %*c %d %d", &ppid, &pgid) == 2) printf("%s %ld %d %d\n", markers[m], pid, ppid, pgid);
    }
  }
  closedir(proc);
  return 0;
}

// ---- probe and devices: the seam suite's process.

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
  int is_unix = strcmp(op, "unix") == 0;
  int fd = socket(is_unix ? AF_UNIX : AF_INET, SOCK_STREAM, 0);
  if (fd < 0) { report(op, target, 0, errno); return; }
  int rc;
  if (is_unix) {
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

/** Whether this process can open the device node: a sandbox with no devices has none of them. */
static int opens(const char *node) {
  int fd = open(node, O_RDONLY | O_NONBLOCK | O_CLOEXEC);
  if (fd < 0) return 0;
  close(fd);
  return 1;
}

static int devices(void) {
  const char *names[] = { "camera", "microphone", "audio-output", "screen-capture" };
  const char *nodes[] = { "/dev/video0", "/dev/snd/controlC0", "/dev/snd/controlC0", "/dev/dri/card0" };
  for (int i = 0; i < 4; i++) fprintf(out, "{\"device\":\"%s\",\"sandbox\":\"%s\"}\n", names[i], opens(nodes[i]) ? "allow" : "deny");
  return 0;
}

// ---- The grant, as `confine` reads it.

#define MAX_PATHS 256
#define MAX_PORTS 64
typedef struct { char *paths[MAX_PATHS]; int n; } Paths;
typedef struct { int ports[MAX_PORTS]; int n; int any; } Ports;
typedef struct {
  Paths read, write, sockets, guards;
  /** Each guard's exceptions, as "<guard index>:<path>" pairs: exceptions[i] belongs to guards.paths[guard_of[i]]. */
  Paths excepts;
  int guard_of[MAX_PATHS];
  Ports connect, listen;
  int as_you;
  /** The planted wrong program of the seam's suite: writes anywhere, reads as granted (suite.ts). */
  int plant_writes;
  int log_fd;
} Spec;

static void push(Paths *p, const char *path) {
  if (p->n >= MAX_PATHS) { fprintf(stderr, "deep sandbox: more than %d paths in one grant\n", MAX_PATHS); exit(126); }
  p->paths[p->n++] = strdup(path);
}

/** The real path of what exists, or of its nearest existing parent with the rest appended: how the kernel sees it. */
static int real_path(const char *path, char *out) {
  if (realpath(path, out)) return 0;
  char copy[PATH_MAX], rest[PATH_MAX];
  snprintf(copy, sizeof copy, "%s", path);
  rest[0] = 0;
  for (;;) {
    char *slash = strrchr(copy, '/');
    if (!slash) return -1;
    char tail[PATH_MAX];
    snprintf(tail, sizeof tail, "/%s%s", slash + 1, rest);
    snprintf(rest, sizeof rest, "%s", tail);
    if (slash == copy) { snprintf(out, PATH_MAX, "%s", rest); return 0; }
    *slash = 0;
    if (realpath(copy, out)) {
      size_t n = strlen(out);
      if (n == 1 && out[0] == '/') n = 0;
      snprintf(out + n, PATH_MAX - n, "%s", rest);
      return 0;
    }
  }
}

/** Whether `path` is `root` or under it. */
static int under(const char *path, const char *root) {
  size_t n = strlen(root);
  if (n == 1 && root[0] == '/') return 1;
  return strncmp(path, root, n) == 0 && (path[n] == 0 || path[n] == '/');
}
/** Whether `path` is `root` itself or one of its ancestors. */
static int ancestor_or_self(const char *path, const char *root) { return under(root, path); }

static int in_any(const Paths *p, const char *path) {
  for (int i = 0; i < p->n; i++) if (under(path, p->paths[i])) return 1;
  return 0;
}
/** Whether a guard keeps the path from writes: inside one, and outside that guard's exceptions. */
static int guarded(const Spec *s, const char *path) {
  for (int g = 0; g < s->guards.n; g++) {
    if (!under(path, s->guards.paths[g])) continue;
    int excepted = 0;
    for (int e = 0; e < s->excepts.n; e++) if (s->guard_of[e] == g && under(path, s->excepts.paths[e])) excepted = 1;
    if (!excepted) return 1;
  }
  return 0;
}
/** Whether moving or removing `path` would move a guarded path along with it. */
static int carries_guard(const Spec *s, const char *path) {
  for (int g = 0; g < s->guards.n; g++) if (ancestor_or_self(path, s->guards.paths[g])) return 1;
  return 0;
}
/** Whether the grant lets the process change what is at `path`. */
static int may_write(const Spec *s, const char *path) {
  if (under(path, "/dev") || under(path, "/proc")) return 1;
  if (guarded(s, path)) return 0;
  return s->as_you || s->plant_writes || in_any(&s->write, path);
}

static int parse_spec(int argc, char **argv, Spec *s, int *program_at) {
  memset(s, 0, sizeof *s);
  s->log_fd = -1;
  int i = 2;
  for (; i < argc; i++) {
    const char *flag = argv[i];
    if (strcmp(flag, "--") == 0) { i++; break; }
    if (strcmp(flag, "--as-you") == 0) { s->as_you = 1; continue; }
    if (strcmp(flag, "--plant-writes") == 0) { s->plant_writes = 1; continue; }
    if (i + 1 >= argc) { fprintf(stderr, "deep sandbox: %s needs a value\n", flag); return -1; }
    const char *value = argv[++i];
    char real[PATH_MAX];
    if (strcmp(flag, "--log-fd") == 0) s->log_fd = atoi(value);
    else if (strcmp(flag, "--connect") == 0 || strcmp(flag, "--listen") == 0) {
      Ports *p = flag[2] == 'c' ? &s->connect : &s->listen;
      if (strcmp(value, "any") == 0) p->any = 1;
      else if (p->n < MAX_PORTS) p->ports[p->n++] = atoi(value);
    } else if (strcmp(flag, "--except") == 0) {
      if (!s->guards.n || real_path(value, real) != 0) continue;
      s->guard_of[s->excepts.n] = s->guards.n - 1;
      push(&s->excepts, real);
    } else {
      Paths *p = strcmp(flag, "--read") == 0 ? &s->read : strcmp(flag, "--write") == 0 ? &s->write : strcmp(flag, "--socket") == 0 ? &s->sockets : strcmp(flag, "--guard") == 0 ? &s->guards : NULL;
      if (!p) { fprintf(stderr, "deep sandbox: unknown flag %s\n", flag); return -1; }
      if (real_path(value, real) == 0) push(p, real);
    }
  }
  if (i >= argc) { fprintf(stderr, "deep sandbox: no program after --\n"); return -1; }
  *program_at = i;
  return 0;
}

// ---- Landlock: the files the grant names, and nothing else.

// Landlock's newer rights and scopes, for a kernel newer than the headers it was built against.
#ifndef LANDLOCK_ACCESS_FS_IOCTL_DEV
#define LANDLOCK_ACCESS_FS_IOCTL_DEV (1ULL << 15)
#endif
#ifndef LANDLOCK_SCOPE_ABSTRACT_UNIX_SOCKET
#define LANDLOCK_SCOPE_ABSTRACT_UNIX_SOCKET (1ULL << 0)
#endif
#ifndef LANDLOCK_SCOPE_SIGNAL
#define LANDLOCK_SCOPE_SIGNAL (1ULL << 1)
#endif
/** landlock_ruleset_attr as ABI 6 lays it out; the size passed is what the kernel's ABI knows. */
struct ruleset_attr { __u64 handled_access_fs; __u64 handled_access_net; __u64 scoped; };

static int landlock_abi(void) {
  long abi = syscall(SYS_landlock_create_ruleset, NULL, 0, LANDLOCK_CREATE_RULESET_VERSION);
  return abi < 0 ? 0 : (int)abi;
}

#define LL_READ (LANDLOCK_ACCESS_FS_EXECUTE | LANDLOCK_ACCESS_FS_READ_FILE | LANDLOCK_ACCESS_FS_READ_DIR)
#define LL_ALL_V1 (LL_READ | LANDLOCK_ACCESS_FS_WRITE_FILE | LANDLOCK_ACCESS_FS_REMOVE_DIR | LANDLOCK_ACCESS_FS_REMOVE_FILE | LANDLOCK_ACCESS_FS_MAKE_CHAR | \
                   LANDLOCK_ACCESS_FS_MAKE_DIR | LANDLOCK_ACCESS_FS_MAKE_REG | LANDLOCK_ACCESS_FS_MAKE_SOCK | LANDLOCK_ACCESS_FS_MAKE_FIFO | \
                   LANDLOCK_ACCESS_FS_MAKE_BLOCK | LANDLOCK_ACCESS_FS_MAKE_SYM)

/** Programs and files the system ships, readable by every sandboxed process; the sandbox's /dev is its own, device-free. */
/** /dev/stdin, stdout, stderr and fd lead to the descriptors themselves, which Landlock never governs. */
static const char *DEV_NODES[] = { "/dev/null", "/dev/zero", "/dev/full", "/dev/random", "/dev/urandom", "/dev/tty", "/dev/ptmx", NULL };
static const char *DEV_DIRS[] = { "/dev/pts", "/dev/shm", NULL };
static const char *SYSTEM_READ[] = { "/usr", "/bin", "/sbin", "/lib", "/lib32", "/lib64", "/libx32", "/etc", "/opt", "/var", "/snap", "/proc", "/sys", "/run", NULL };

static int add_rule(int ruleset, const char *path, uint64_t access) {
  int fd = open(path, O_PATH | O_CLOEXEC);
  if (fd < 0) return 0; // a path that isn't there grants nothing
  struct stat st;
  if (fstat(fd, &st) != 0 || !(S_ISREG(st.st_mode) || S_ISDIR(st.st_mode) || S_ISCHR(st.st_mode) || S_ISBLK(st.st_mode))) { close(fd); return 0; } // a pipe or socket: no rule to make
  // A rule on a file (a granted script, a device node) may carry only the rights a file has; a directory's are refused.
  if (!S_ISDIR(st.st_mode)) access &= LANDLOCK_ACCESS_FS_EXECUTE | LANDLOCK_ACCESS_FS_READ_FILE | LANDLOCK_ACCESS_FS_WRITE_FILE | LANDLOCK_ACCESS_FS_TRUNCATE | LANDLOCK_ACCESS_FS_IOCTL_DEV;
  struct landlock_path_beneath_attr attr = { .allowed_access = access, .parent_fd = fd };
  int rc = syscall(SYS_landlock_add_rule, ruleset, LANDLOCK_RULE_PATH_BENEATH, &attr, 0);
  close(fd);
  return rc;
}

/** The ruleset from the grant: its fd, or -1 with a message. */
static int ruleset_of(const Spec *s, const char *cwd, int abi) {
  uint64_t all = LL_ALL_V1;
  if (abi >= 2) all |= LANDLOCK_ACCESS_FS_REFER;
  if (abi >= 3) all |= LANDLOCK_ACCESS_FS_TRUNCATE;
  if (abi >= 5) all |= LANDLOCK_ACCESS_FS_IOCTL_DEV;
  struct ruleset_attr attr = { .handled_access_fs = all, .handled_access_net = 0, .scoped = 0 };
  if (abi >= 6) attr.scoped = LANDLOCK_SCOPE_ABSTRACT_UNIX_SOCKET | LANDLOCK_SCOPE_SIGNAL;
  int ruleset = syscall(SYS_landlock_create_ruleset, &attr, abi >= 6 ? sizeof attr : 2 * sizeof(__u64), 0);
  if (ruleset < 0) { perror("deep sandbox: landlock_create_ruleset"); return -1; }
  int rc = 0;
  if (s->as_you) rc |= add_rule(ruleset, "/", all);
  else {
    for (int i = 0; SYSTEM_READ[i]; i++) rc |= add_rule(ruleset, SYSTEM_READ[i], LL_READ);
    rc |= add_rule(ruleset, cwd, LL_READ);
    for (int i = 0; i < s->read.n; i++) rc |= add_rule(ruleset, s->read.paths[i], LL_READ);
    for (int i = 0; i < s->write.n; i++) rc |= add_rule(ruleset, s->write.paths[i], all);
    if (s->plant_writes) rc |= add_rule(ruleset, "/", all & ~(uint64_t)LL_READ);
  }
  // Of /dev, the nodes every program needs: null, zero, full, random, the terminal, shared memory. Never a device.
  for (int i = 0; DEV_NODES[i]; i++) rc |= add_rule(ruleset, DEV_NODES[i], LANDLOCK_ACCESS_FS_READ_FILE | LANDLOCK_ACCESS_FS_WRITE_FILE | (abi >= 5 ? LANDLOCK_ACCESS_FS_IOCTL_DEV : 0));
  for (int i = 0; DEV_DIRS[i]; i++) rc |= add_rule(ruleset, DEV_DIRS[i], all);
  if (rc != 0) { perror("deep sandbox: landlock_add_rule"); close(ruleset); return -1; }
  return ruleset;
}

static int restrict_self(int ruleset) {
  if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0) { perror("deep sandbox: no_new_privs"); return -1; }
  if (syscall(SYS_landlock_restrict_self, ruleset, 0) != 0) { perror("deep sandbox: landlock_restrict_self"); return -1; }
  return 0;
}

// ---- seccomp: the socket families a process may open, and the calls the parent answers.

#define BPF_MAX 512
static struct sock_filter prog[BPF_MAX];
static int prog_n;
static void emit(struct sock_filter f) {
  if (prog_n >= BPF_MAX) { fprintf(stderr, "deep sandbox: seccomp program too long\n"); exit(126); }
  prog[prog_n++] = f;
}
#define ARG(i) ((unsigned)offsetof(struct seccomp_data, args[i]))
#define LD_NR emit((struct sock_filter)BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)))
#define LD_ARG(i) emit((struct sock_filter)BPF_STMT(BPF_LD | BPF_W | BPF_ABS, ARG(i)))
#define JEQ(k, jt, jf) emit((struct sock_filter)BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, (unsigned)(k), jt, jf))
#define JSET(k, jt, jf) emit((struct sock_filter)BPF_JUMP(BPF_JMP | BPF_JSET | BPF_K, (unsigned)(k), jt, jf))
#define AND(k) emit((struct sock_filter)BPF_STMT(BPF_ALU | BPF_AND | BPF_K, (unsigned)(k)))
#define RET(v) emit((struct sock_filter)BPF_STMT(BPF_RET | BPF_K, (unsigned)(v)))
#define ERRNO(e) (SECCOMP_RET_ERRNO | ((e) & SECCOMP_RET_DATA))

/** One syscall with one verdict: "if nr == x return v". */
static void rule(int nr, unsigned verdict) {
  if (nr < 0) return;
  JEQ(nr, 0, 1);
  RET(verdict);
}
/** An open: the parent is asked only when its flags can write or create. */
static void open_rule(int nr, int flags_arg) {
  if (nr < 0) return;
  JEQ(nr, 0, 4);
  LD_ARG(flags_arg);
  JSET(O_WRONLY | O_RDWR | O_CREAT | O_TRUNC | O_TMPFILE, 0, 1);
  RET(SECCOMP_RET_USER_NOTIF);
  RET(SECCOMP_RET_ALLOW);
  LD_NR;
}
#ifndef __NR_open
#define __NR_open -101
#endif
#ifndef __NR_creat
#define __NR_creat -102
#endif
#ifndef __NR_mkdir
#define __NR_mkdir -103
#endif
#ifndef __NR_rmdir
#define __NR_rmdir -104
#endif
#ifndef __NR_unlink
#define __NR_unlink -105
#endif
#ifndef __NR_rename
#define __NR_rename -106
#endif
#ifndef __NR_symlink
#define __NR_symlink -107
#endif
#ifndef __NR_link
#define __NR_link -108
#endif
#ifndef __NR_mknod
#define __NR_mknod -109
#endif
#ifndef __NR_chmod
#define __NR_chmod -110
#endif
#ifndef __NR_chown
#define __NR_chown -111
#endif
#ifndef __NR_lchown
#define __NR_lchown -112
#endif
#ifndef __NR_utimes
#define __NR_utimes -113
#endif
#ifndef __NR_utime
#define __NR_utime -114
#endif
#ifndef __NR_futimesat
#define __NR_futimesat -115
#endif
#ifndef __NR_fchmodat2
#define __NR_fchmodat2 452
#endif

static struct sock_fprog build_filter(void) {
  prog_n = 0;
  emit((struct sock_filter)BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, arch)));
  JEQ(ARCH_NR, 1, 0);
  RET(SECCOMP_RET_KILL_PROCESS);
  LD_NR;
  // socket: Unix sockets; TCP, which the parent checks at connect and bind; and the kernel's routing table. Nothing else.
  JEQ(__NR_socket, 0, 14);
  LD_ARG(0);
  JEQ(AF_UNIX, 0, 1);
  RET(SECCOMP_RET_ALLOW);
  JEQ(AF_NETLINK, 0, 3);
  LD_ARG(2);
  JEQ(NETLINK_ROUTE, 0, 6);
  RET(SECCOMP_RET_ALLOW);
  JEQ(AF_INET, 1, 0);
  JEQ(AF_INET6, 0, 3);
  LD_ARG(1);
  AND(0xff);
  JEQ(SOCK_STREAM, 1, 0);
  RET(ERRNO(EACCES));
  RET(SECCOMP_RET_ALLOW);
  LD_NR;
  JEQ(__NR_socketpair, 0, 4);
  LD_ARG(0);
  JEQ(AF_UNIX, 0, 1);
  RET(SECCOMP_RET_ALLOW);
  RET(ERRNO(EACCES));
  LD_NR;
  // Opens that can write or create: the parent decides and records.
  open_rule(__NR_openat, 2);
  open_rule(__NR_open, 1);
  rule(__NR_creat, SECCOMP_RET_USER_NOTIF);
  rule(__NR_openat2, SECCOMP_RET_USER_NOTIF);
  // What the parent checks and does itself, or refuses and records.
  const int notified[] = { __NR_connect, __NR_bind, __NR_mkdirat, __NR_mkdir, __NR_unlinkat, __NR_unlink, __NR_rmdir, __NR_renameat, __NR_renameat2, __NR_rename, __NR_symlinkat, __NR_symlink,
                           __NR_linkat, __NR_link, __NR_mknodat, __NR_mknod, __NR_truncate, __NR_fchmodat, __NR_fchmodat2, __NR_chmod, __NR_fchmod, __NR_fchownat, __NR_chown, __NR_lchown, __NR_fchown,
                           __NR_utimensat, __NR_utimes, __NR_utime, __NR_futimesat, __NR_setxattr, __NR_lsetxattr, __NR_fsetxattr, __NR_removexattr, __NR_lremovexattr, __NR_fremovexattr };
  for (size_t i = 0; i < sizeof notified / sizeof *notified; i++) rule(notified[i], SECCOMP_RET_USER_NOTIF);
  // Ways around the filter or into another process: none.
  const int refused[] = { __NR_ptrace, __NR_process_vm_readv, __NR_process_vm_writev, __NR_pidfd_getfd, __NR_io_uring_setup, __NR_io_uring_enter, __NR_io_uring_register, __NR_kexec_load, __NR_open_by_handle_at };
  for (size_t i = 0; i < sizeof refused / sizeof *refused; i++) rule(refused[i], ERRNO(EPERM));
  RET(SECCOMP_RET_ALLOW);
  return (struct sock_fprog){ .len = (unsigned short)prog_n, .filter = prog };
}

// ---- The parent: answers the filter's notifications for the whole run.

typedef struct {
  const Spec *spec;
  int listener;
  struct seccomp_notif *req;
  struct seccomp_notif_resp *resp;
  size_t req_size, resp_size;
} Server;

static void log_denial(const Spec *s, const char *operation, const char *target) {
  if (s->log_fd < 0) return;
  char line[PATH_MAX + 128];
  int n = snprintf(line, sizeof line, "{\"operation\":\"%s\",\"target\":\"", operation);
  // The target as JSON: quotes, backslashes and control characters escaped.
  for (const char *c = target; *c && n < (int)sizeof line - 8; c++) {
    if (*c == '"' || *c == '\\') n += snprintf(line + n, sizeof line - n, "\\%c", *c);
    else if ((unsigned char)*c < 0x20) n += snprintf(line + n, sizeof line - n, "\\u%04x", (unsigned char)*c);
    else line[n++] = *c;
  }
  n += snprintf(line + n, sizeof line - n, "\"}\n");
  if (write(s->log_fd, line, (size_t)n) < 0) { /* nobody reading: the record goes without it */ }
}

/** Bytes of the notifying process's memory. */
static int read_mem(pid_t tid, uint64_t addr, void *buf, size_t len) {
  struct iovec local = { buf, len }, remote = { (void *)(uintptr_t)addr, len };
  return process_vm_readv(tid, &local, 1, &remote, 1, 0) == (ssize_t)len ? 0 : -1;
}
/** A NUL-ended string of the notifying process's memory, read a page at a time so a string that ends short of a page's end is read whole. */
static int read_str(pid_t tid, uint64_t addr, char *buf, size_t cap) {
  size_t got = 0;
  while (got < cap) {
    size_t to_page = 4096 - (addr + got) % 4096;
    size_t n = to_page < cap - got ? to_page : cap - got;
    struct iovec local = { buf + got, n }, remote = { (void *)(uintptr_t)(addr + got), n };
    ssize_t r = process_vm_readv(tid, &local, 1, &remote, 1, 0);
    if (r <= 0) return -1;
    for (ssize_t i = 0; i < r; i++) if (buf[got + i] == 0) return 0;
    got += (size_t)r;
  }
  return -1;
}

/** The thread's process, as pidfd_open wants it. */
static pid_t tgid_of(pid_t tid) {
  char path[64], line[128];
  snprintf(path, sizeof path, "/proc/%d/status", tid);
  FILE *f = fopen(path, "r");
  if (!f) return -1;
  pid_t tgid = -1;
  while (fgets(line, sizeof line, f)) if (sscanf(line, "Tgid: %d", &tgid) == 1) break;
  fclose(f);
  return tgid;
}
/** The notifying process's own file descriptor, as a descriptor of this process: the same open file. */
static int take_fd(pid_t tid, int fd) {
  pid_t tgid = tgid_of(tid);
  if (tgid < 0) return -1;
  int pidfd = syscall(SYS_pidfd_open, tgid, 0);
  if (pidfd < 0) return -1;
  int mine = syscall(SYS_pidfd_getfd, pidfd, fd, 0);
  close(pidfd);
  return mine;
}
/** The directory a relative path is read from: the process's cwd, or its dirfd. */
static int base_of(pid_t tid, int dirfd, const char *path) {
  if (path[0] == '/') return -2; // not needed
  if (dirfd == AT_FDCWD) {
    char cwd[64];
    snprintf(cwd, sizeof cwd, "/proc/%d/cwd", tid);
    return open(cwd, O_PATH | O_DIRECTORY | O_CLOEXEC);
  }
  return take_fd(tid, dirfd);
}
static int real_of_fd(int fd, char *out) {
  char link[64];
  snprintf(link, sizeof link, "/proc/self/fd/%d", fd);
  ssize_t n = readlink(link, out, PATH_MAX - 1);
  if (n < 0) return -1;
  out[n] = 0;
  return 0;
}

/**
 * Where the process's path leads, resolved by this process in the same namespaces: an O_PATH descriptor of what is
 * there and its real path, or, with `parent_ok`, of its parent directory with the name appended, for what is
 * about to be made. Symlinks in the last component are followed unless `nofollow`.
 */
static int locate(pid_t tid, int dirfd, const char *path, int nofollow, int parent_ok, char *real, int *fd_out) {
  int base = base_of(tid, dirfd, path);
  if (base == -1) return -1;
  int basefd = base == -2 ? AT_FDCWD : base;
  int fd = openat(basefd, path, O_PATH | O_CLOEXEC | (nofollow ? O_NOFOLLOW : 0));
  if (fd < 0 && errno == ENOENT && parent_ok) {
    char copy[PATH_MAX];
    snprintf(copy, sizeof copy, "%s", path);
    char *slash = strrchr(copy, '/');
    const char *name = slash ? slash + 1 : copy;
    const char *dir = slash ? (slash == copy ? "/" : (*slash = 0, copy)) : ".";
    int parent = openat(basefd, dir, O_PATH | O_DIRECTORY | O_CLOEXEC);
    if (parent >= 0 && real_of_fd(parent, real) == 0) {
      size_t n = strlen(real);
      snprintf(real + n, PATH_MAX - n, "%s%s", n == 1 && real[0] == '/' ? "" : "/", name);
      if (base >= 0) close(base);
      if (fd_out) *fd_out = parent; else close(parent);
      return 0;
    }
    if (parent >= 0) close(parent);
  }
  if (base >= 0) close(base);
  if (fd < 0) return -1;
  if (real_of_fd(fd, real) != 0) { close(fd); return -1; }
  if (fd_out) *fd_out = fd; else close(fd);
  return 0;
}

static void answer(Server *v, long val, int err, int cont) {
  memset(v->resp, 0, v->resp_size);
  v->resp->id = v->req->id;
  v->resp->val = val;
  v->resp->error = -err;
  v->resp->flags = cont ? SECCOMP_USER_NOTIF_FLAG_CONTINUE : 0;
}
#define CONTINUE(v) answer(v, 0, 0, 1)
#define REFUSE(v, e) answer(v, -1, e, 0)
#define RESULT(v, rc) answer(v, (rc) < 0 ? -1 : (rc), (rc) < 0 ? errno : 0, 0)
static int still_waiting(Server *v) { return ioctl(v->listener, SECCOMP_IOCTL_NOTIF_ID_VALID, &v->req->id) == 0; }

/** Whether a path the process names may be written; a refusal is recorded. */
static int write_allowed(Server *v, int dirfd, uint64_t path_addr, int nofollow, int parent_ok, const char *operation) {
  char path[PATH_MAX], real[PATH_MAX];
  if (read_str(v->req->pid, path_addr, path, sizeof path) != 0) { REFUSE(v, EFAULT); return 0; }
  if (locate(v->req->pid, dirfd, path, nofollow, parent_ok, real, NULL) != 0) { CONTINUE(v); return 0; } // nothing there to protect: the kernel answers
  if (may_write(v->spec, real)) return 1;
  log_denial(v->spec, operation, real);
  REFUSE(v, EACCES);
  return 0;
}

static int loopback(const struct sockaddr_storage *a) {
  if (a->ss_family == AF_INET) return (ntohl(((const struct sockaddr_in *)a)->sin_addr.s_addr) >> 24) == 127;
  const struct in6_addr *in6 = &((const struct sockaddr_in6 *)a)->sin6_addr;
  if (IN6_IS_ADDR_LOOPBACK(in6)) return 1;
  return IN6_IS_ADDR_V4MAPPED(in6) && in6->s6_addr[12] == 127;
}
static int port_of(const struct sockaddr_storage *a) {
  return ntohs(a->ss_family == AF_INET ? ((const struct sockaddr_in *)a)->sin_port : ((const struct sockaddr_in6 *)a)->sin6_port);
}
static int port_granted(const Ports *p, int port) {
  if (p->any) return 1;
  for (int i = 0; i < p->n; i++) if (p->ports[i] == port) return 1;
  return 0;
}

/** connect(2) and bind(2): checked here, and made on the process's own socket, so what was checked is what connects. */
static void handle_socket_call(Server *v, int is_bind) {
  struct sockaddr_storage a;
  memset(&a, 0, sizeof a);
  socklen_t len = (socklen_t)v->req->data.args[2];
  if (len > sizeof a) len = sizeof a;
  if (len < sizeof(sa_family_t) || read_mem(v->req->pid, v->req->data.args[1], &a, len) != 0) { REFUSE(v, EFAULT); return; }
  const char *operation = is_bind ? "network-bind" : "network-outbound";
  char target[PATH_MAX + 32];
  if (a.ss_family == AF_UNIX) {
    const struct sockaddr_un *u = (const struct sockaddr_un *)&a;
    size_t plen = len - offsetof(struct sockaddr_un, sun_path);
    if (is_bind) { CONTINUE(v); return; } // a socket file is made under the grant's write paths: Landlock decides
    if (plen == 0 || u->sun_path[0] == 0) { log_denial(v->spec, operation, "(abstract socket)"); REFUSE(v, EACCES); return; }
    char path[sizeof u->sun_path + 1];
    memcpy(path, u->sun_path, plen < sizeof u->sun_path ? plen : sizeof u->sun_path);
    path[plen < sizeof u->sun_path ? plen : sizeof u->sun_path] = 0;
    char real[PATH_MAX];
    int pathfd;
    if (locate(v->req->pid, AT_FDCWD, path, 0, 0, real, &pathfd) != 0) { REFUSE(v, errno == ENOENT ? ENOENT : EACCES); return; }
    if (!in_any(&v->spec->sockets, real)) { close(pathfd); log_denial(v->spec, operation, real); REFUSE(v, EACCES); return; }
    int sock = still_waiting(v) ? take_fd(v->req->pid, (int)v->req->data.args[0]) : -1;
    if (sock < 0) { close(pathfd); REFUSE(v, EBADF); return; }
    struct sockaddr_un mine;
    memset(&mine, 0, sizeof mine);
    mine.sun_family = AF_UNIX;
    snprintf(mine.sun_path, sizeof mine.sun_path, "/proc/self/fd/%d", pathfd);
    int rc = connect(sock, (struct sockaddr *)&mine, sizeof mine);
    RESULT(v, rc);
    close(sock);
    close(pathfd);
    return;
  }
  if (a.ss_family == AF_INET || a.ss_family == AF_INET6) {
    int port = port_of(&a);
    snprintf(target, sizeof target, "%s:%d", loopback(&a) ? "localhost" : "outside", port);
    int ok = is_bind ? port != 0 && port_granted(&v->spec->listen, port) : loopback(&a) && port_granted(&v->spec->connect, port);
    if (!ok) { log_denial(v->spec, operation, target); REFUSE(v, EACCES); return; }
    int sock = still_waiting(v) ? take_fd(v->req->pid, (int)v->req->data.args[0]) : -1;
    if (sock < 0) { REFUSE(v, EBADF); return; }
    int rc = is_bind ? bind(sock, (struct sockaddr *)&a, len) : connect(sock, (struct sockaddr *)&a, len);
    RESULT(v, rc);
    close(sock);
    return;
  }
  if (a.ss_family == AF_NETLINK) { CONTINUE(v); return; }
  log_denial(v->spec, operation, "(other address family)");
  REFUSE(v, EACCES);
}

/** rename(2): both ends checked, then made by this process from the directories it resolved, under the same Landlock rules. */
static void handle_rename(Server *v, int olddirfd, uint64_t oldp, int newdirfd, uint64_t newp, unsigned flags) {
  char from[PATH_MAX], to[PATH_MAX], rfrom[PATH_MAX], rto[PATH_MAX];
  pid_t tid = v->req->pid;
  if (read_str(tid, oldp, from, sizeof from) != 0 || read_str(tid, newp, to, sizeof to) != 0) { REFUSE(v, EFAULT); return; }
  if (locate(tid, olddirfd, from, 1, 0, rfrom, NULL) != 0) { CONTINUE(v); return; } // nothing there: the kernel's own ENOENT
  if (locate(tid, newdirfd, to, 1, 1, rto, NULL) != 0) { CONTINUE(v); return; }
  if (!may_write(v->spec, rfrom) || carries_guard(v->spec, rfrom)) { log_denial(v->spec, "file-write-unlink", rfrom); REFUSE(v, EACCES); return; }
  if (!may_write(v->spec, rto) || carries_guard(v->spec, rto)) { log_denial(v->spec, "file-write-create", rto); REFUSE(v, EACCES); return; }
  // Made from each end's parent, opened by this process: the name under it is what moves, whatever else changes meanwhile.
  char fcopy[PATH_MAX], tcopy[PATH_MAX];
  snprintf(fcopy, sizeof fcopy, "%s", rfrom);
  snprintf(tcopy, sizeof tcopy, "%s", rto);
  char *fslash = strrchr(fcopy, '/'), *tslash = strrchr(tcopy, '/');
  if (!fslash || !tslash) { REFUSE(v, EACCES); return; }
  const char *fname = fslash + 1, *tname = tslash + 1;
  *fslash = fslash == fcopy ? (fcopy[1] = 0, '/') : 0;
  *tslash = tslash == tcopy ? (tcopy[1] = 0, '/') : 0;
  int fdir = open(fcopy, O_PATH | O_DIRECTORY | O_CLOEXEC), tdir = open(tcopy, O_PATH | O_DIRECTORY | O_CLOEXEC);
  if (fdir < 0 || tdir < 0) { if (fdir >= 0) close(fdir); if (tdir >= 0) close(tdir); REFUSE(v, errno); return; }
  if (!still_waiting(v)) { close(fdir); close(tdir); return; }
  int rc = syscall(SYS_renameat2, fdir, fname, tdir, tname, flags);
  RESULT(v, rc);
  close(fdir);
  close(tdir);
}

/** A change to a file's mode, owner, times or attributes, by path or by descriptor: checked, then made by this process. */
static void handle_meta(Server *v, int nr) {
  pid_t tid = v->req->pid;
  const __u64 *a = v->req->data.args;
  char path[PATH_MAX], real[PATH_MAX];
  int fd = -1;
  int by_fd = nr == __NR_fchmod || nr == __NR_fchown || nr == __NR_fsetxattr || nr == __NR_fremovexattr || (nr == __NR_utimensat && a[1] == 0);
  if (by_fd) {
    fd = take_fd(tid, (int)a[0]);
    if (fd < 0 || real_of_fd(fd, real) != 0) { if (fd >= 0) close(fd); REFUSE(v, EBADF); return; }
  } else {
    int dirfd = AT_FDCWD, flags = 0;
    uint64_t p;
    if (nr == __NR_fchmodat || nr == __NR_fchmodat2 || nr == __NR_fchownat || nr == __NR_utimensat || nr == __NR_futimesat) { dirfd = (int)a[0]; p = a[1]; }
    else p = a[0];
    if (nr == __NR_fchownat) flags = (int)a[4];
    else if (nr == __NR_fchmodat2) flags = (int)a[3];
    else if (nr == __NR_utimensat) flags = (int)a[3];
    int nofollow = (flags & AT_SYMLINK_NOFOLLOW) || nr == __NR_lchown || nr == __NR_lsetxattr || nr == __NR_lremovexattr;
    if (read_str(tid, p, path, sizeof path) != 0) { REFUSE(v, EFAULT); return; }
    if (locate(tid, dirfd, path, nofollow, 0, real, &fd) != 0) { CONTINUE(v); return; }
  }
  const char *operation = nr == __NR_fchmodat || nr == __NR_fchmodat2 || nr == __NR_chmod || nr == __NR_fchmod ? "file-write-mode"
    : nr == __NR_fchownat || nr == __NR_chown || nr == __NR_lchown || nr == __NR_fchown ? "file-write-owner"
    : nr == __NR_utimensat || nr == __NR_utimes || nr == __NR_utime || nr == __NR_futimesat ? "file-write-times" : "file-write-xattr";
  if (!may_write(v->spec, real)) { close(fd); log_denial(v->spec, operation, real); REFUSE(v, EACCES); return; }
  if (!still_waiting(v)) { close(fd); return; }
  // Made on the file this process resolved, named by its descriptor: the same file whatever the path now leads to.
  char via[64];
  snprintf(via, sizeof via, "/proc/self/fd/%d", fd);
  int rc = -1;
  char name[256];
  static char value[65536];
  switch (nr) {
    case __NR_fchmodat: case __NR_fchmodat2: case __NR_chmod: case __NR_fchmod:
      rc = chmod(via, (mode_t)(nr == __NR_fchmod || nr == __NR_chmod ? a[1] : a[2]));
      break;
    case __NR_fchownat: case __NR_chown: case __NR_lchown: case __NR_fchown:
      rc = chown(via, (uid_t)a[1 + (nr == __NR_fchownat)], (gid_t)a[2 + (nr == __NR_fchownat)]);
      break;
    case __NR_utimensat: {
      struct timespec ts[2];
      uint64_t tp = a[2];
      if (tp && read_mem(tid, tp, ts, sizeof ts) != 0) { close(fd); REFUSE(v, EFAULT); return; }
      rc = utimensat(AT_FDCWD, via, tp ? ts : NULL, 0);
      break;
    }
    case __NR_setxattr: case __NR_lsetxattr: case __NR_fsetxattr: {
      size_t size = (size_t)a[3];
      if (read_str(tid, a[1], name, sizeof name) != 0 || size > sizeof value || (size && read_mem(tid, a[2], value, size) != 0)) { close(fd); REFUSE(v, EFAULT); return; }
      rc = setxattr(via, name, value, size, (int)a[4]);
      break;
    }
    case __NR_removexattr: case __NR_lremovexattr: case __NR_fremovexattr:
      if (read_str(tid, a[1], name, sizeof name) != 0) { close(fd); REFUSE(v, EFAULT); return; }
      rc = removexattr(via, name);
      break;
    default:
      // utimes, utime, futimesat: the old forms, with a time the process gives in other shapes; the kernel takes them.
      close(fd);
      CONTINUE(v);
      return;
  }
  RESULT(v, rc);
  close(fd);
}

static void handle(Server *v) {
  const __u64 *a = v->req->data.args;
  int nr = v->req->data.nr;
  if (nr == __NR_connect || nr == __NR_bind) { handle_socket_call(v, nr == __NR_bind); return; }
  if (nr == __NR_openat || nr == __NR_open || nr == __NR_creat || nr == __NR_openat2) {
    int dirfd = nr == __NR_openat || nr == __NR_openat2 ? (int)a[0] : AT_FDCWD;
    uint64_t p = nr == __NR_openat || nr == __NR_openat2 ? a[1] : a[0];
    unsigned flags = nr == __NR_openat ? (unsigned)a[2] : nr == __NR_open ? (unsigned)a[1] : O_WRONLY | O_CREAT | O_TRUNC;
    if (nr == __NR_openat2) {
      struct open_how how;
      memset(&how, 0, sizeof how);
      size_t size = (size_t)a[3] < sizeof how ? (size_t)a[3] : sizeof how;
      if (read_mem(v->req->pid, a[2], &how, size) != 0) { REFUSE(v, EFAULT); return; }
      flags = (unsigned)how.flags;
      if (!(flags & (O_WRONLY | O_RDWR | O_CREAT | O_TRUNC | O_TMPFILE))) { CONTINUE(v); return; }
    }
    const char *operation = flags & O_CREAT ? "file-write-create" : "file-write-data";
    if (write_allowed(v, dirfd, p, (flags & O_NOFOLLOW) != 0, (flags & O_CREAT) != 0, operation)) CONTINUE(v);
    return;
  }
  if (nr == __NR_mkdirat || nr == __NR_mkdir || nr == __NR_mknodat || nr == __NR_mknod) {
    int at = nr == __NR_mkdirat || nr == __NR_mknodat;
    if (write_allowed(v, at ? (int)a[0] : AT_FDCWD, at ? a[1] : a[0], 1, 1, "file-write-create")) CONTINUE(v);
    return;
  }
  if (nr == __NR_symlinkat || nr == __NR_symlink) {
    if (write_allowed(v, nr == __NR_symlinkat ? (int)a[1] : AT_FDCWD, nr == __NR_symlinkat ? a[2] : a[1], 1, 1, "file-write-create")) CONTINUE(v);
    return;
  }
  if (nr == __NR_linkat || nr == __NR_link) {
    if (write_allowed(v, nr == __NR_linkat ? (int)a[2] : AT_FDCWD, nr == __NR_linkat ? a[3] : a[1], 1, 1, "file-write-create")) CONTINUE(v);
    return;
  }
  if (nr == __NR_unlinkat || nr == __NR_unlink || nr == __NR_rmdir) {
    if (write_allowed(v, nr == __NR_unlinkat ? (int)a[0] : AT_FDCWD, nr == __NR_unlinkat ? a[1] : a[0], 1, 0, "file-write-unlink")) CONTINUE(v);
    return;
  }
  if (nr == __NR_truncate) {
    if (write_allowed(v, AT_FDCWD, a[0], 0, 0, "file-write-data")) CONTINUE(v);
    return;
  }
  if (nr == __NR_renameat2) { handle_rename(v, (int)a[0], a[1], (int)a[2], a[3], (unsigned)a[4]); return; }
  if (nr == __NR_renameat) { handle_rename(v, (int)a[0], a[1], (int)a[2], a[3], 0); return; }
  if (nr == __NR_rename) { handle_rename(v, AT_FDCWD, a[0], AT_FDCWD, a[1], 0); return; }
  handle_meta(v, nr);
}

static int serve(const Spec *spec, int listener, pid_t child) {
  struct seccomp_notif_sizes sizes;
  if (syscall(SYS_seccomp, SECCOMP_GET_NOTIF_SIZES, 0, &sizes) != 0) { perror("deep sandbox: seccomp sizes"); return 126; }
  Server v = { .spec = spec, .listener = listener, .req = calloc(1, sizes.seccomp_notif), .resp = calloc(1, sizes.seccomp_notif_resp), .req_size = sizes.seccomp_notif, .resp_size = sizes.seccomp_notif_resp };
  if (!v.req || !v.resp) return 126;
  // Every process the program leaves behind becomes this one's child: the run is over once none is left, and
  // until then each keeps the filter answered.
  prctl(PR_SET_CHILD_SUBREAPER, 1, 0, 0, 0);
  int status = 0, exited = 0;
  struct pollfd p = { .fd = listener, .events = POLLIN };
  for (;;) {
    int st;
    pid_t gone = waitpid(-1, &st, WNOHANG);
    if (gone == child) {
      status = st;
      exited = 1;
      // The program's own end, as it happened, for the supervisor: bwrap's status would come later, after every
      // leftover, and as 128 + the signal.
      if (spec->log_fd >= 0) {
        char line[64];
        int n = WIFEXITED(st) ? snprintf(line, sizeof line, "{\"exit\":%d}\n", WEXITSTATUS(st)) : snprintf(line, sizeof line, "{\"exit\":null,\"signal\":%d}\n", WIFSIGNALED(st) ? WTERMSIG(st) : 0);
        if (write(spec->log_fd, line, (size_t)n) < 0) { /* nobody reading */ }
      }
    }
    if (gone < 0 && errno == ECHILD) break;
    int ready = poll(&p, 1, gone > 0 ? 0 : 200);
    if (ready < 0 && errno != EINTR) break;
    if (ready > 0 && (p.revents & POLLIN)) {
      memset(v.req, 0, v.req_size);
      if (ioctl(listener, SECCOMP_IOCTL_NOTIF_RECV, v.req) != 0) { if (errno == EINTR || errno == ENOENT) continue; break; }
      handle(&v);
      if (ioctl(listener, SECCOMP_IOCTL_NOTIF_SEND, v.resp) != 0 && errno != ENOENT) { /* the process is gone */ }
    }
  }
  free(v.req);
  free(v.resp);
  if (!exited) { waitpid(child, &status, 0); exited = 1; }
  return WIFEXITED(status) ? WEXITSTATUS(status) : WIFSIGNALED(status) ? 128 + WTERMSIG(status) : 126;
}

static int send_fd(int sock, int fd) {
  char byte = 0;
  struct iovec io = { &byte, 1 };
  char ctl[CMSG_SPACE(sizeof fd)];
  struct msghdr msg = { .msg_iov = &io, .msg_iovlen = 1, .msg_control = ctl, .msg_controllen = sizeof ctl };
  struct cmsghdr *c = CMSG_FIRSTHDR(&msg);
  c->cmsg_level = SOL_SOCKET;
  c->cmsg_type = SCM_RIGHTS;
  c->cmsg_len = CMSG_LEN(sizeof fd);
  memcpy(CMSG_DATA(c), &fd, sizeof fd);
  return sendmsg(sock, &msg, 0) == 1 ? 0 : -1;
}
static int recv_fd(int sock) {
  char byte;
  struct iovec io = { &byte, 1 };
  char ctl[CMSG_SPACE(sizeof(int))];
  struct msghdr msg = { .msg_iov = &io, .msg_iovlen = 1, .msg_control = ctl, .msg_controllen = sizeof ctl };
  if (recvmsg(sock, &msg, 0) != 1) return -1;
  struct cmsghdr *c = CMSG_FIRSTHDR(&msg);
  if (!c || c->cmsg_type != SCM_RIGHTS) return -1;
  int fd;
  memcpy(&fd, CMSG_DATA(c), sizeof fd);
  return fd;
}

/** DEEP_CONFINE split at its unit separators into an argument list shaped like "helper confine <flags> -- <program>...". */
static char **spec_argv(int *argc) {
  const char *raw = getenv("DEEP_CONFINE");
  if (!raw) { fprintf(stderr, "deep sandbox: DEEP_CONFINE names no grant and program\n"); return NULL; }
  char *copy = strdup(raw);
  int n = 2;
  for (const char *c = raw; *c; c++) if (*c == 0x1f) n++;
  char **argv = calloc((size_t)n + 2, sizeof *argv);
  if (!copy || !argv) return NULL;
  argv[0] = "helper";
  argv[1] = "confine";
  int i = 2;
  for (char *tok = copy, *end; tok; tok = end) {
    end = strchr(tok, 0x1f);
    if (end) *end++ = 0;
    argv[i++] = tok;
  }
  argv[i] = NULL;
  *argc = i;
  unsetenv("DEEP_CONFINE");
  return argv;
}

static int confine(void) {
  Spec spec;
  int at, argc;
  char **argv = spec_argv(&argc);
  if (!argv || parse_spec(argc, argv, &spec, &at) != 0) return 126;
  int abi = landlock_abi();
  if (abi < 4) { fprintf(stderr, "deep sandbox: this kernel's Landlock ABI is %d; the Linux sandbox needs 4 or later (Linux 6.7)\n", abi); return 126; }
  if (spec.log_fd >= 0 && fcntl(spec.log_fd, F_GETFD) < 0) spec.log_fd = -1;
  char cwd[PATH_MAX];
  if (!getcwd(cwd, sizeof cwd)) { perror("deep sandbox: getcwd"); return 126; }
  int ruleset = ruleset_of(&spec, cwd, abi);
  if (ruleset < 0) return 126;
  int pair[2];
  if (socketpair(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0, pair) != 0) { perror("deep sandbox: socketpair"); return 126; }
  // The parent answers under the same file rules, so what it does for the program is what the program may do; and
  // it takes them before the fork, so the program's own domain nests in its parent's, which Landlock lets the parent
  // read the program's memory through, and never the other way round.
  if (restrict_self(ruleset) != 0) return 126;
  pid_t child = fork();
  if (child < 0) { perror("deep sandbox: fork"); return 126; }
  if (child == 0) {
    close(pair[0]);
    // Nothing of the parent's reaches the program: not the denial log, not the ruleset, and no signal to the parent.
    if (spec.log_fd >= 0) close(spec.log_fd);
    if (restrict_self(ruleset) != 0) _exit(126);
    close(ruleset);
    struct sock_fprog filter = build_filter();
    int listener = syscall(SYS_seccomp, SECCOMP_SET_MODE_FILTER, SECCOMP_FILTER_FLAG_NEW_LISTENER, &filter);
    if (listener < 0) { perror("deep sandbox: seccomp"); _exit(126); }
    if (send_fd(pair[1], listener) != 0) { perror("deep sandbox: listener"); _exit(126); }
    close(listener);
    close(pair[1]);
    execvp(argv[at], argv + at);
    fprintf(stderr, "deep sandbox: %s: %s\n", argv[at], strerror(errno));
    _exit(127);
  }
  close(pair[1]);
  close(ruleset);
  int listener = recv_fd(pair[0]);
  close(pair[0]);
  if (listener < 0) {
    int status = 0;
    waitpid(child, &status, 0);
    return WIFEXITED(status) ? WEXITSTATUS(status) : 126;
  }
  // The run's own signals end its processes; this one ends when they are gone.
  signal(SIGINT, SIG_IGN);
  signal(SIGTERM, SIG_IGN);
  signal(SIGHUP, SIG_IGN);
  signal(SIGPIPE, SIG_IGN);
  return serve(&spec, listener, child);
}

int main(int argc, char **argv) {
  if (argc >= 2 && strcmp(argv[1], "scan") == 0) return scan(argc - 2, argv + 2);
  if (argc >= 2 && strcmp(argv[1], "landlock") == 0) { printf("%d\n", landlock_abi()); return 0; }
  if (argc >= 2 && strcmp(argv[1], "confine") == 0) return confine();
  if (argc < 3) { fprintf(stderr, "usage: helper scan <marker>... | landlock | confine (DEEP_CONFINE) | probe <file> <op> <arg>... | devices <file>\n"); return 2; }
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
