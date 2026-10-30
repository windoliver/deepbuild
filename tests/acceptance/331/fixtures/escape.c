// escape: #331 AC10's stack server and its escaped helper. Every process writes <piddir>/<role>.<pid> once it
// listens (server, helper), so the test knows each PID. Both answer GET /health with 200 and their role and PID.
//
//   escape <port> <piddir>          the stack's dev server (done.yaml's `up`, run through the supervisor): listens on
//                                   127.0.0.1:<port> with SO_REUSEPORT, so a helper can listen there beside it.
//   escape helper <port> <piddir>   the escape, as the criterion words it: a double fork whose middle process exits
//                                   at once; the grandchild calls setsid and execs itself as "hold" with an empty
//                                   environment (no run token). This launcher exits 0 once the helper listens.
//   escape hold <port> <piddir>     (internal) the helper after its exec: listens on 127.0.0.1:<port> with
//                                   SO_REUSEPORT, beside the stack's server, and keeps listening after it is gone.
//
// On macOS a process started inside a run's Seatbelt profile keeps it through fork, exec and setsid, and the
// supervisor's scan records it whatever its parent, group or environment (README, How each criterion is read,
// AC10). So the test runs `escape helper` from outside the hub, where only a route out of the sandbox (launchd)
// could put the helper: the escape itself is the same, and nothing the supervisor watches ever holds it.
#include <arpa/inet.h>
#include <netinet/in.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <fcntl.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <unistd.h>
#include <dirent.h>

static const char *dir;

static void mark(const char *role) {
  char path[1024];
  snprintf(path, sizeof path, "%s/%s.%d", dir, role, (int)getpid());
  int fd = open(path, O_WRONLY | O_CREAT | O_TRUNC, 0644);
  if (fd >= 0) close(fd);
}
static int marked(const char *role) {
  DIR *d = opendir(dir);
  if (!d) return 0;
  size_t n = strlen(role);
  int found = 0;
  struct dirent *e;
  while (!found && (e = readdir(d))) found = strncmp(e->d_name, role, n) == 0 && e->d_name[n] == '.';
  closedir(d);
  return found;
}

/** Listens on 127.0.0.1:port beside any other SO_REUSEPORT listener there, marks the role, and answers forever. */
static int serve(const char *role, int port) {
  int s = socket(AF_INET, SOCK_STREAM, 0);
  int one = 1;
  setsockopt(s, SOL_SOCKET, SO_REUSEADDR, &one, sizeof one);
  setsockopt(s, SOL_SOCKET, SO_REUSEPORT, &one, sizeof one);
  struct sockaddr_in a;
  memset(&a, 0, sizeof a);
  a.sin_family = AF_INET;
  a.sin_port = htons((unsigned short)port);
  a.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  if (bind(s, (struct sockaddr *)&a, sizeof a) != 0 || listen(s, 64) != 0) { perror("escape: bind"); return 65; }
  mark(role);
  signal(SIGPIPE, SIG_IGN);
  for (;;) {
    int c = accept(s, NULL, NULL);
    if (c < 0) continue;
    char buf[2048];
    ssize_t n = read(c, buf, sizeof buf - 1);
    buf[n > 0 ? n : 0] = 0;
    char body[128];
    snprintf(body, sizeof body, "{\"ok\":true,\"role\":\"%s\",\"port\":%d,\"pid\":%d}", role, port, (int)getpid());
    int healthy = strncmp(buf, "GET /health ", 12) == 0;
    char out[512];
    snprintf(out, sizeof out, "HTTP/1.1 %s\r\nContent-Type: application/json\r\nContent-Length: %zu\r\nConnection: close\r\n\r\n%s",
             healthy ? "200 OK" : "404 Not Found", healthy ? strlen(body) : 0, healthy ? body : "");
    write(c, out, strlen(out));
    close(c);
  }
}

int main(int argc, char **argv) {
  if (argc == 3) {
    dir = argv[2];
    mkdir(dir, 0755);
    return serve("server", atoi(argv[1]));
  }
  if (argc != 4) { fprintf(stderr, "usage: escape <port> <piddir> | escape helper <port> <piddir>\n"); return 2; }
  dir = argv[3];
  if (strcmp(argv[1], "hold") == 0) return serve("helper", atoi(argv[2]));
  if (strcmp(argv[1], "helper") != 0) return 2;
  mkdir(dir, 0755);
  pid_t middle = fork();
  if (middle < 0) return 70;
  if (middle == 0) {
    if (fork() == 0) {
      setsid();
      char *hargv[] = { argv[0], "hold", argv[2], (char *)dir, NULL };
      char *envp[] = { NULL };
      execve(argv[0], hargv, envp);
      _exit(127);
    }
    _exit(0);
  }
  waitpid(middle, NULL, 0);
  for (int i = 0; i < 500; i++) {
    if (marked("helper")) return 0;
    usleep(10000);
  }
  fprintf(stderr, "escape: the helper never listened on %s\n", argv[2]);
  return 1;
}
