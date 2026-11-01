// The supervisor's native helper on Linux (#70): the bubblewrap backend's two steps around a process, built
// beside the package's JavaScript by its build script, and the seam suite's device probe.
//
//   helper box <cgroup> [<policy>...] -- bwrap [<bwrap option>...] -- <program> [<arg>...]
//                               starts the filter's server outside the sandbox, joins the cgroup (made if missing), and
//                               runs bwrap with `helper confine` inside it around the program. A cgroup is inherited
//                               through fork, exec and setsid and can't be left without a write to it that nothing
//                               inside has, so it is the run's marker, and its cgroup.procs lists every process the run
//                               holds. Where the caller gave descriptor 3, bwrap reports the program's process on it,
//                               `{"child-pid": n}`, and the server each refusal, `{"deny": "<operation>", "target": "…"}`.
//   helper confine [<policy>...] --link <fd> -- <program> [<arg>...]
//                               inside the sandbox: puts this process under a Landlock ruleset and a seccomp filter made
//                               from the policy, hands the filter's listener to the server over <fd>, and becomes the
//                               program, in a process group of its own.
//   The policy: [--read <path>] [--write <path>] [--connect <port>] [--listen <port>] [--unix <path>] [--any-host].
//                               Files and programs only where --read and --write say (EACCES elsewhere); TCP connects
//                               and binds only to the ports named, on this machine; a local socket only at the paths
//                               named (EPERM elsewhere). A connect to a named socket is made by the server on the
//                               program's own socket, so the path it checked is the path connected. --any-host leaves
//                               the network filter out: a planted backend's, for the seam's suite.
//   The server:                 serves the filter from outside the sandbox, where it holds every capability over the
//                               sandbox's user namespace, so it reads any process of the run; it ends once nothing is
//                               left under the filter. Nothing in the sandbox can trace it: it isn't dumpable, and the
//                               sandbox holds no capability.
//   helper devices <file>       what this process can reach of each device, by opening it: one line each for the camera
//                               (/dev/video*), the microphone and the audio output (/dev/snd) and a screen capture (the
//                               display's socket); "deny" where the open fails, however it fails.
#define _GNU_SOURCE
#include <arpa/inet.h>
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/landlock.h>
#include <linux/seccomp.h>
#include <netinet/in.h>
#include <poll.h>
#include <signal.h>
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
#include <sys/un.h>
#include <sys/wait.h>
#include <unistd.h>
#include "helper.h"

// Rights and scopes newer than the build machine's headers: the running kernel's ABI decides whether they apply.
#ifndef LANDLOCK_ACCESS_FS_IOCTL_DEV
#define LANDLOCK_ACCESS_FS_IOCTL_DEV (1ULL << 15)
#endif
#ifndef LANDLOCK_SCOPE_ABSTRACT_UNIX_SOCKET
#define LANDLOCK_SCOPE_ABSTRACT_UNIX_SOCKET (1ULL << 0)
#endif
/** The ruleset attributes as ABI 6 lays them out; an older kernel reads only the size it is given. */
struct ruleset_attr { uint64_t handled_access_fs; uint64_t handled_access_net; uint64_t scoped; };

#if defined(__aarch64__)
#define ARCH AUDIT_ARCH_AARCH64
#elif defined(__x86_64__)
#define ARCH AUDIT_ARCH_X86_64
#else
#error "the Linux helper is built for arm64 and x86_64"
#endif

/** The descriptor the supervisor gives for the status stream (bubblewrap.ts). */
#define STATUS_FD 3
#define WRITE_FLAGS (O_WRONLY | O_RDWR | O_CREAT | O_TRUNC)

static int fail(const char *what) {
  fprintf(stderr, "helper: %s: %s\n", what, strerror(errno));
  return 2;
}
/** This helper's own program, as bwrap runs it again inside the sandbox. */
static const char *self_path(void) {
  static char path[PATH_MAX];
  ssize_t n = readlink("/proc/self/exe", path, sizeof path - 1);
  if (n < 0) { perror("helper: /proc/self/exe"); exit(2); }
  path[n] = '\0';
  return path;
}

// ---- The policy.

#define MAX_PATHS 256
#define MAX_PORTS 256
struct policy {
  const char *read[MAX_PATHS]; int reads;
  const char *write[MAX_PATHS]; int writes;
  const char *unix_[MAX_PATHS]; int unixes;
  int connect_[MAX_PORTS]; int connects;
  int listen[MAX_PORTS]; int listens;
  int any_host;
  int link;
};

static int port_arg(const char *s) {
  char *end;
  long port = strtol(s, &end, 10);
  if (*s == '\0' || *end != '\0' || port < 0 || port > 65535) { fprintf(stderr, "helper: not a port: %s\n", s); exit(2); }
  return (int)port;
}

/** Reads the policy from argv[from..], up to "--"; the index of that "--", or -1. */
static int parse(struct policy *p, int argc, char **argv, int from) {
  memset(p, 0, sizeof *p);
  p->link = -1;
  int i = from;
  for (; i < argc && strcmp(argv[i], "--") != 0; i++) {
    const char *flag = argv[i];
    if (strcmp(flag, "--any-host") == 0) { p->any_host = 1; continue; }
    if (i + 1 >= argc) { fprintf(stderr, "helper: %s needs a value\n", flag); exit(2); }
    const char *value = argv[++i];
    if (strcmp(flag, "--read") == 0 && p->reads < MAX_PATHS) p->read[p->reads++] = value;
    else if (strcmp(flag, "--write") == 0 && p->writes < MAX_PATHS) p->write[p->writes++] = value;
    else if (strcmp(flag, "--unix") == 0 && p->unixes < MAX_PATHS) p->unix_[p->unixes++] = value;
    else if (strcmp(flag, "--connect") == 0 && p->connects < MAX_PORTS) p->connect_[p->connects++] = port_arg(value);
    else if (strcmp(flag, "--listen") == 0 && p->listens < MAX_PORTS) p->listen[p->listens++] = port_arg(value);
    else if (strcmp(flag, "--link") == 0) p->link = port_arg(value);
    else { fprintf(stderr, "helper: unknown option %s\n", flag); exit(2); }
  }
  return i < argc ? i : -1;
}

// ---- Landlock, inside the sandbox.

static int landlock_create(const struct ruleset_attr *attr, size_t size, uint32_t flags) {
  return (int)syscall(__NR_landlock_create_ruleset, attr, size, flags);
}
static int landlock_add(int fd, enum landlock_rule_type type, const void *rule) {
  return (int)syscall(__NR_landlock_add_rule, fd, type, rule, 0);
}
static int landlock_restrict(int fd) { return (int)syscall(__NR_landlock_restrict_self, fd, 0); }

#define FS_READ (LANDLOCK_ACCESS_FS_EXECUTE | LANDLOCK_ACCESS_FS_READ_FILE | LANDLOCK_ACCESS_FS_READ_DIR)
/** Every file access right the running kernel's Landlock knows: a right its ABI lacks can't be handled. */
static uint64_t fs_rights(int abi) {
  uint64_t rights = (1ULL << 13) - 1;              // ABI 1: execute .. make_sym
  if (abi >= 2) rights |= LANDLOCK_ACCESS_FS_REFER;
  if (abi >= 3) rights |= LANDLOCK_ACCESS_FS_TRUNCATE;
  if (abi >= 5) rights |= LANDLOCK_ACCESS_FS_IOCTL_DEV;
  return rights;
}

/** The rights a rule on a file, rather than a folder, may carry. */
static uint64_t file_rights(int abi) {
  uint64_t rights = LANDLOCK_ACCESS_FS_EXECUTE | LANDLOCK_ACCESS_FS_WRITE_FILE | LANDLOCK_ACCESS_FS_READ_FILE;
  if (abi >= 3) rights |= LANDLOCK_ACCESS_FS_TRUNCATE;
  if (abi >= 5) rights |= LANDLOCK_ACCESS_FS_IOCTL_DEV;
  return rights;
}

static int add_path(int ruleset, int abi, const char *path, uint64_t access) {
  struct landlock_path_beneath_attr rule = { .allowed_access = access };
  rule.parent_fd = open(path, O_PATH | O_CLOEXEC);
  // A path that isn't there grants nothing, and can't be reached either.
  if (rule.parent_fd < 0) return errno == ENOENT || errno == ENOTDIR || errno == EACCES ? 0 : -1;
  struct stat st;
  if (fstat(rule.parent_fd, &st) == 0 && !S_ISDIR(st.st_mode)) rule.allowed_access &= file_rights(abi);
  int rc = landlock_add(ruleset, LANDLOCK_RULE_PATH_BENEATH, &rule);
  close(rule.parent_fd);
  return rc;
}
static int add_port(int ruleset, int port, uint64_t access) {
  struct landlock_net_port_attr rule = { .allowed_access = access, .port = (uint64_t)port };
  return landlock_add(ruleset, LANDLOCK_RULE_NET_PORT, &rule);
}

/** Restricts this process to the policy's files and TCP ports; the network needs Landlock ABI 4 (Linux 6.7). */
static int apply_landlock(const struct policy *p) {
  int abi = landlock_create(NULL, 0, LANDLOCK_CREATE_RULESET_VERSION);
  if (abi < 4) { fprintf(stderr, "helper: Landlock ABI 4 or later is needed, and this kernel has %d\n", abi); return -1; }
  uint64_t fs = fs_rights(abi);
  struct ruleset_attr attr = { .handled_access_fs = fs, .handled_access_net = p->any_host ? 0 : (LANDLOCK_ACCESS_NET_CONNECT_TCP | LANDLOCK_ACCESS_NET_BIND_TCP), .scoped = 0 };
  size_t size = offsetof(struct ruleset_attr, scoped);
  if (abi >= 6) {
    // A local socket outside the sandbox is one a grant names by path: an abstract one has none, so it's out of reach.
    attr.scoped = LANDLOCK_SCOPE_ABSTRACT_UNIX_SOCKET;
    size = sizeof attr;
  }
  int ruleset = landlock_create(&attr, size, 0);
  if (ruleset < 0) { perror("helper: landlock_create_ruleset"); return -1; }
  for (int i = 0; i < p->reads; i++) if (add_path(ruleset, abi, p->read[i], FS_READ) != 0) { perror(p->read[i]); return -1; }
  for (int i = 0; i < p->writes; i++) if (add_path(ruleset, abi, p->write[i], fs) != 0) { perror(p->write[i]); return -1; }
  if (!p->any_host) {
    for (int i = 0; i < p->connects; i++) if (add_port(ruleset, p->connect_[i], LANDLOCK_ACCESS_NET_CONNECT_TCP) != 0) { perror("helper: connect port"); return -1; }
    for (int i = 0; i < p->listens; i++) if (add_port(ruleset, p->listen[i], LANDLOCK_ACCESS_NET_BIND_TCP) != 0) { perror("helper: listen port"); return -1; }
  }
  if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0) { perror("helper: no_new_privs"); return -1; }
  if (landlock_restrict(ruleset) != 0) { perror("helper: landlock_restrict_self"); return -1; }
  close(ruleset);
  return 0;
}

// ---- The filter, inside the sandbox.

/**
 * connect, a send with an address, and an open for writing go to the server; every other call runs as it would. The
 * server decides connects and sends; an open it only reads, to record what Landlock is about to refuse.
 */
static int install_filter(void) {
  struct sock_filter code[] = {
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, arch)),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, ARCH, 1, 0),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS),
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_connect, 11, 0),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_sendmsg, 10, 0),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_openat2, 9, 0),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_openat, 0, 3),
    // openat: only with a flag that writes, creates or truncates.
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[2])),
    BPF_JUMP(BPF_JMP | BPF_JSET | BPF_K, WRITE_FLAGS, 6, 0),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_sendto, 0, 5),
    // sendto with no address goes on a connected socket, which was checked when it connected.
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[4])),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, 0, 0, 2),
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[4]) + 4),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, 0, 1, 0),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_USER_NOTIF),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
  };
  struct sock_fprog prog = { .len = sizeof code / sizeof code[0], .filter = code };
  return (int)syscall(__NR_seccomp, SECCOMP_SET_MODE_FILTER, SECCOMP_FILTER_FLAG_NEW_LISTENER, &prog);
}

static int confine(int argc, char **argv) {
  struct policy p;
  int at = parse(&p, argc, argv, 2);
  if (at < 0 || at + 1 >= argc || p.link < 0) { fprintf(stderr, "usage: helper confine [<policy>...] --link <fd> -- <program> [<arg>...]\n"); return 2; }
  char **program = argv + at + 1;
  if (apply_landlock(&p) != 0) return 2;
  int listener = install_filter();
  if (listener < 0) return fail("seccomp");
  // The server takes the listener out of this process by its number, and says so before this process closes its copy.
  struct { pid_t pid; int fd; } mine = { getpid(), listener };
  char ack;
  if (write(p.link, &mine, sizeof mine) != (ssize_t)sizeof mine || read(p.link, &ack, 1) != 1) return fail("the filter's server");
  close(listener);
  close(p.link);
  // The program and its children in a group of their own: what the run's cleanup stops in bwrap's group is bwrap's.
  setpgid(0, 0);
  // Nothing of bwrap's or the supervisor's beyond its standard streams reaches the program.
  syscall(__NR_close_range, 3, ~0U, 0);
  execvp(program[0], program);
  perror(program[0]);
  return 127;
}

// ---- The server, outside the sandbox.

static int status = -1;

/** One refusal on the status stream, as JSON on one line, so the supervisor records it against the run. */
static void report(const char *operation, const char *target) {
  if (status < 0) return;
  char line[PATH_MAX * 2 + 64];
  int n = snprintf(line, sizeof line, "{\"deny\": \"%s\", \"target\": \"", operation);
  for (const char *c = target; *c && n < (int)sizeof line - 8; c++) {
    if (*c == '"' || *c == '\\') line[n++] = '\\';
    if ((unsigned char)*c < 0x20) n += snprintf(line + n, sizeof line - (size_t)n, "\\u%04x", (unsigned char)*c);
    else line[n++] = *c;
  }
  n += snprintf(line + n, sizeof line - (size_t)n, "\"}\n");
  if (write(status, line, (size_t)n) < 0) { /* the supervisor is gone: nothing to tell */ }
}

/** `len` bytes of the program's memory at `at`, or -1. */
static int read_mem(pid_t pid, uint64_t at, void *to, size_t len) {
  char path[64];
  snprintf(path, sizeof path, "/proc/%d/mem", pid);
  int fd = open(path, O_RDONLY | O_CLOEXEC);
  if (fd < 0) return -1;
  ssize_t n = pread(fd, to, len, (off_t)at);
  close(fd);
  return n == (ssize_t)len ? 0 : -1;
}
/** The string of the program's memory at `at`, up to PATH_MAX; 0 when read whole. */
static int read_str(pid_t pid, uint64_t at, char *to, size_t room) {
  char path[64];
  snprintf(path, sizeof path, "/proc/%d/mem", pid);
  int fd = open(path, O_RDONLY | O_CLOEXEC);
  if (fd < 0) return -1;
  size_t got = 0;
  while (got < room - 1) {
    ssize_t n = pread(fd, to + got, room - 1 - got, (off_t)(at + got));
    if (n <= 0) break;
    got += (size_t)n;
    if (memchr(to + got - (size_t)n, '\0', (size_t)n)) break;
  }
  close(fd);
  to[got] = '\0';
  return memchr(to, '\0', got + 1) ? 0 : -1;
}

static int loopback(const struct sockaddr_storage *a) {
  if (a->ss_family == AF_INET) return ntohl(((const struct sockaddr_in *)a)->sin_addr.s_addr) >> 24 == 127;
  if (a->ss_family == AF_INET6) {
    const struct in6_addr *in6 = &((const struct sockaddr_in6 *)a)->sin6_addr;
    if (IN6_IS_ADDR_LOOPBACK(in6)) return 1;
    return IN6_IS_ADDR_V4MAPPED(in6) && in6->s6_addr[12] == 127;
  }
  return 0;
}
static int port_of(const struct sockaddr_storage *a) {
  return ntohs(a->ss_family == AF_INET ? ((const struct sockaddr_in *)a)->sin_port : ((const struct sockaddr_in6 *)a)->sin6_port);
}
static void host_of(const struct sockaddr_storage *a, char *to, size_t room) {
  char ip[INET6_ADDRSTRLEN] = "?";
  if (a->ss_family == AF_INET) inet_ntop(AF_INET, &((const struct sockaddr_in *)a)->sin_addr, ip, sizeof ip);
  else inet_ntop(AF_INET6, &((const struct sockaddr_in6 *)a)->sin6_addr, ip, sizeof ip);
  snprintf(to, room, "%s:%d", ip, port_of(a));
}
static int same_file(const char *a, const char *b) {
  struct stat sa, sb;
  if (stat(a, &sa) != 0 || stat(b, &sb) != 0) return strcmp(a, b) == 0;
  return sa.st_dev == sb.st_dev && sa.st_ino == sb.st_ino;
}

/** Connects the program's own socket (a duplicate of its descriptor) to `addr`: the address checked is the one connected. */
static int connect_for(pid_t pid, int fd, const struct sockaddr_storage *addr, socklen_t len) {
  int pidfd = (int)syscall(__NR_pidfd_open, pid, 0);
  if (pidfd < 0) return -errno;
  int sock = (int)syscall(__NR_pidfd_getfd, pidfd, fd, 0);
  int e = errno;
  close(pidfd);
  if (sock < 0) return -e;
  int rc = connect(sock, (const struct sockaddr *)addr, len);
  e = errno;
  close(sock);
  return rc == 0 ? 0 : -e;
}

/** `dir/name` into `to`, cut to fit. */
static void under(char *to, size_t room, const char *dir, const char *name) {
  size_t n = strlen(dir), m = strlen(name);
  if (n > room - 2) n = room - 2;
  if (m > room - 2 - n) m = room - 2 - n;
  memcpy(to, dir, n);
  to[n] = '/';
  memcpy(to + n + 1, name, m);
  to[n + 1 + m] = '\0';
}
/** The path an open names, made absolute from the program's folder or directory descriptor, and real as far as it exists. */
static void opened_path(pid_t pid, int dirfd, const char *given, char *to, size_t room) {
  char base[PATH_MAX] = "";
  if (given[0] != '/') {
    char link[64];
    if (dirfd == AT_FDCWD) snprintf(link, sizeof link, "/proc/%d/cwd", pid);
    else snprintf(link, sizeof link, "/proc/%d/fd/%d", pid, dirfd);
    ssize_t n = readlink(link, base, sizeof base - 1);
    if (n < 0) n = 0;
    base[n] = '\0';
  }
  char joined[PATH_MAX * 2];
  snprintf(joined, sizeof joined, "%s%s%s", base, base[0] && given[0] != '/' ? "/" : "", given);
  // Real up to the file's folder, since the file itself may not exist yet.
  char *slash = strrchr(joined, '/');
  char real_dir[PATH_MAX];
  if (slash && slash != joined) {
    *slash = '\0';
    under(to, room, realpath(joined, real_dir) ? real_dir : joined, slash + 1);
  } else snprintf(to, room, "%s", joined);
}
/** Whether a path lies under one the policy lets the program write. */
static int writable(const struct policy *p, const char *path) {
  for (int i = 0; i < p->writes; i++) {
    const char *w = p->write[i];
    size_t n = strlen(w);
    while (n > 1 && w[n - 1] == '/') n--;
    if (strncmp(path, w, n) == 0 && (n == 1 || path[n] == '/' || path[n] == '\0')) return 1;
  }
  return 0;
}

/** Serves one notification: continue, refuse with EPERM, or connect the socket itself. */
static void serve(int listener, const struct policy *p, struct seccomp_notif *req, struct seccomp_notif_resp *resp) {
  memset(resp, 0, sizeof *resp);
  resp->id = req->id;
  resp->flags = SECCOMP_USER_NOTIF_FLAG_CONTINUE;
  int nr = req->data.nr;
  if (nr == __NR_openat || nr == __NR_openat2) {
    // Read only: Landlock refuses the open itself, and this says so to the record.
    char given[PATH_MAX], path[PATH_MAX * 2];
    if (read_str(req->pid, req->data.args[1], given, sizeof given) != 0) return;
    if (ioctl(listener, SECCOMP_IOCTL_NOTIF_ID_VALID, &req->id) != 0) return;
    opened_path(req->pid, (int)req->data.args[0], given, path, sizeof path);
    if (!writable(p, path)) report(req->data.args[2] & O_CREAT ? "file-write-create" : "file-write-data", path);
    return;
  }
  struct sockaddr_storage addr;
  memset(&addr, 0, sizeof addr);
  uint64_t at = req->data.args[1];
  socklen_t len = (socklen_t)req->data.args[2];
  if (nr == __NR_sendto) { at = req->data.args[4]; len = (socklen_t)req->data.args[5]; }
  if (nr == __NR_sendmsg) {
    struct { uint64_t name; uint32_t namelen; } head;
    if (read_mem(req->pid, req->data.args[1], &head, sizeof head) != 0) { resp->flags = 0; resp->error = -EPERM; return; }
    if (head.name == 0) return;
    at = head.name;
    len = head.namelen;
  }
  resp->flags = 0;
  resp->error = -EPERM;
  if (len < sizeof(sa_family_t) || len > sizeof addr || read_mem(req->pid, at, &addr, len) != 0) return;
  // The program may have ended, and its ID name another, between the request and the read: then nothing is decided on it.
  if (ioctl(listener, SECCOMP_IOCTL_NOTIF_ID_VALID, &req->id) != 0) return;
  if (addr.ss_family == AF_INET || addr.ss_family == AF_INET6) {
    if (p->any_host) { resp->flags = SECCOMP_USER_NOTIF_FLAG_CONTINUE; resp->error = 0; return; }
    int port = port_of(&addr);
    for (int i = 0; i < p->connects; i++) if (p->connect_[i] == port && loopback(&addr)) { resp->flags = SECCOMP_USER_NOTIF_FLAG_CONTINUE; resp->error = 0; return; }
    char host[INET6_ADDRSTRLEN + 8];
    host_of(&addr, host, sizeof host);
    report("network-outbound", host);
    return;
  }
  if (addr.ss_family != AF_UNIX) { resp->flags = SECCOMP_USER_NOTIF_FLAG_CONTINUE; resp->error = 0; return; }
  const struct sockaddr_un *un = (const struct sockaddr_un *)&addr;
  size_t room = len - offsetof(struct sockaddr_un, sun_path);
  // Unnamed (autobind) and abstract sockets have no path a grant could name.
  if (room == 0 || un->sun_path[0] == '\0') { report("network-outbound", "(unnamed socket)"); return; }
  char path[sizeof un->sun_path + 1];
  memcpy(path, un->sun_path, room);
  path[room] = '\0';
  for (int i = 0; i < p->unixes; i++) {
    if (!same_file(path, p->unix_[i])) continue;
    if (nr != __NR_connect) { resp->flags = SECCOMP_USER_NOTIF_FLAG_CONTINUE; resp->error = 0; return; }
    resp->error = connect_for(req->pid, (int)req->data.args[0], &addr, len);
    return;
  }
  report("network-outbound", path);
}

/** Serves the listener until every process under the filter is gone (the listener then hangs up). */
static int serve_until_hangup(int listener, const struct policy *p) {
  struct seccomp_notif_sizes sizes;
  if (syscall(__NR_seccomp, SECCOMP_GET_NOTIF_SIZES, 0, &sizes) != 0) return fail("seccomp sizes");
  struct seccomp_notif *req = calloc(1, sizes.seccomp_notif);
  struct seccomp_notif_resp *resp = calloc(1, sizes.seccomp_notif_resp);
  if (!req || !resp) return fail("calloc");
  for (;;) {
    struct pollfd fd = { .fd = listener, .events = POLLIN };
    if (poll(&fd, 1, -1) < 0) { if (errno == EINTR) continue; return fail("poll"); }
    if (fd.revents & POLLIN) {
      memset(req, 0, sizes.seccomp_notif);
      if (ioctl(listener, SECCOMP_IOCTL_NOTIF_RECV, req) != 0) { if (errno == EINTR || errno == ENOENT) continue; return fail("notif recv"); }
      serve(listener, p, req, resp);
      // ENOENT: the program gave up the call (a signal) before the answer; nothing to tell it.
      if (ioctl(listener, SECCOMP_IOCTL_NOTIF_SEND, resp) != 0 && errno != ENOENT) return fail("notif send");
    } else if (fd.revents & (POLLHUP | POLLERR)) return 0;
  }
}

/** Takes the listener from the program, named by its process and descriptor over the link, and says so. */
static int take_listener(int link) {
  struct { pid_t pid; int fd; } theirs;
  if (read(link, &theirs, sizeof theirs) != (ssize_t)sizeof theirs) return -1;
  int pidfd = (int)syscall(__NR_pidfd_open, theirs.pid, 0);
  if (pidfd < 0) return -1;
  int fd = (int)syscall(__NR_pidfd_getfd, pidfd, theirs.fd, 0);
  close(pidfd);
  char ack = 0;
  if (write(link, &ack, 1) != 1) { if (fd >= 0) close(fd); return -1; }
  return fd;
}

static int server(int link, const struct policy *p) {
  prctl(PR_SET_DUMPABLE, 0, 0, 0, 0);
  // Not the run's streams: the run's output ends when the program's does.
  int null = open("/dev/null", O_RDWR | O_CLOEXEC);
  if (null >= 0) { dup2(null, 0); dup2(null, 1); dup2(null, 2); }
  status = fcntl(STATUS_FD, F_GETFD) >= 0 ? STATUS_FD : -1;
  int listener = take_listener(link);
  close(link);
  if (listener < 0) return 2;
  return serve_until_hangup(listener, p);
}

// ---- box: the server, the cgroup, then bwrap.

static int join_cgroup(const char *dir) {
  if (mkdir(dir, 0755) != 0 && errno != EEXIST) return fail(dir);
  char path[PATH_MAX];
  snprintf(path, sizeof path, "%s/cgroup.procs", dir);
  int fd = open(path, O_WRONLY | O_CLOEXEC);
  if (fd < 0) return fail(path);
  char pid[32];
  int n = snprintf(pid, sizeof pid, "%d\n", getpid());
  if (write(fd, pid, (size_t)n) != n) return fail(path);
  close(fd);
  return 0;
}

static int box(int argc, char **argv) {
  struct policy p;
  int at = argc >= 3 ? parse(&p, argc, argv, 3) : -1;
  int program = -1;
  for (int i = at + 1; at >= 0 && i < argc; i++) if (strcmp(argv[i], "--") == 0) { program = i; break; }
  if (at < 0 || program < 0 || program + 1 >= argc) { fprintf(stderr, "usage: helper box <cgroup> [<policy>...] -- bwrap [<option>...] -- <program> [<arg>...]\n"); return 2; }
  int pair[2];
  if (socketpair(AF_UNIX, SOCK_STREAM, 0, pair) != 0) return fail("socketpair");
  pid_t served = fork();
  if (served < 0) return fail("fork");
  if (served == 0) { close(pair[1]); _exit(server(pair[0], &p)); }
  close(pair[0]);
  if (join_cgroup(argv[2]) != 0) return 2;
  // bwrap, with the program's own process reported where the caller gave the status descriptor, around confine.
  int has_status = fcntl(STATUS_FD, F_GETFD) >= 0;
  char link[16];
  snprintf(link, sizeof link, "%d", pair[1]);
  char **args = calloc((size_t)argc + 8, sizeof(char *));
  if (!args) return fail("calloc");
  int n = 0;
  for (int i = at + 1; i < program; i++) args[n++] = argv[i];
  if (has_status) { args[n++] = "--json-status-fd"; args[n++] = "3"; }
  args[n++] = "--";
  args[n++] = (char *)self_path();
  args[n++] = "confine";
  for (int i = 3; i < at; i++) args[n++] = argv[i];
  args[n++] = "--link";
  args[n++] = link;
  args[n++] = "--";
  for (int i = program + 1; i < argc; i++) args[n++] = argv[i];
  execvp(args[0], args);
  return fail(args[0]);
}

// ---- devices.

static int opens(const char *path, int flags) {
  int fd = open(path, flags | O_CLOEXEC | O_NONBLOCK);
  if (fd < 0) return 0;
  close(fd);
  return 1;
}
static int reaches_socket(const char *path) {
  int fd = socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);
  if (fd < 0) return 0;
  struct sockaddr_un a;
  memset(&a, 0, sizeof a);
  a.sun_family = AF_UNIX;
  strncpy(a.sun_path, path, sizeof a.sun_path - 1);
  int rc = connect(fd, (struct sockaddr *)&a, sizeof a);
  close(fd);
  return rc == 0;
}
static int camera(void) {
  DIR *dev = opendir("/dev");
  if (!dev) return 0;
  struct dirent *e;
  int ok = 0;
  while (!ok && (e = readdir(dev))) {
    if (strncmp(e->d_name, "video", 5) != 0) continue;
    char path[PATH_MAX];
    snprintf(path, sizeof path, "/dev/%s", e->d_name);
    ok = opens(path, O_RDWR);
  }
  closedir(dev);
  return ok;
}
static int display(void) {
  const char *runtime = getenv("XDG_RUNTIME_DIR");
  const char *wayland = getenv("WAYLAND_DISPLAY");
  char path[PATH_MAX];
  if (runtime) {
    snprintf(path, sizeof path, "%s/%s", runtime, wayland && *wayland ? wayland : "wayland-0");
    if (reaches_socket(path)) return 1;
  }
  const char *x = getenv("DISPLAY");
  snprintf(path, sizeof path, "/tmp/.X11-unix/X%s", x && *x == ':' ? x + 1 : "0");
  return reaches_socket(path);
}

int devices_linux(FILE *out) {
  const char *names[] = { "camera", "microphone", "audio-output", "screen-capture" };
  int snd = opens("/dev/snd", O_RDONLY | O_DIRECTORY);
  int verdicts[] = { !camera(), !snd, !snd, !display() };
  for (int i = 0; i < 4; i++) fprintf(out, "{\"device\":\"%s\",\"sandbox\":\"%s\"}\n", names[i], verdicts[i] ? "deny" : "allow");
  return 0;
}

int linux_command(int argc, char **argv) {
  if (strcmp(argv[1], "box") == 0) return box(argc, argv);
  if (strcmp(argv[1], "confine") == 0) return confine(argc, argv);
  return -1;
}
