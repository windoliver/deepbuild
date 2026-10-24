// escape: a dev server whose helper escapes before anything can record it (#331 AC10). It listens on 127.0.0.1
// at the port given, then double-forks a helper: the middle process exits at once, and the grandchild calls setsid
// and execs itself as "hold" with an empty environment (no run token), keeping the listening socket, so after the
// server is gone the helper still listens on the leased port. The server then answers GET /health with 200.
// Every process writes <piddir>/<role>.<pid> first (server, helper), so the test knows each PID.
//
//   escape <port> <piddir>      the server
//   escape hold <piddir>        (internal) the helper, after its exec
#include <arpa/inet.h>
#include <dirent.h>
#include <fcntl.h>
#include <netinet/in.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <unistd.h>

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

int main(int argc, char **argv) {
  if (argc != 3) { fprintf(stderr, "usage: escape <port> <piddir> | escape hold <piddir>\n"); return 2; }
  dir = argv[2];
  if (strcmp(argv[1], "hold") == 0) {
    mark("helper");
    for (;;) pause();
  }
  mkdir(dir, 0755);
  int port = atoi(argv[1]);
  int s = socket(AF_INET, SOCK_STREAM, 0);
  int one = 1;
  setsockopt(s, SOL_SOCKET, SO_REUSEADDR, &one, sizeof one);
  struct sockaddr_in a;
  memset(&a, 0, sizeof a);
  a.sin_family = AF_INET;
  a.sin_port = htons((unsigned short)port);
  a.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  if (bind(s, (struct sockaddr *)&a, sizeof a) != 0 || listen(s, 64) != 0) { perror("escape: bind"); return 65; }
  mark("server");
  pid_t middle = fork();
  if (middle == 0) {
    if (fork() == 0) {
      setsid();
      char *hargv[] = { argv[0], "hold", (char *)dir, NULL };
      char *envp[] = { NULL };
      execve(argv[0], hargv, envp);
      _exit(127);
    }
    _exit(0);
  }
  waitpid(middle, NULL, 0);
  for (int i = 0; i < 500 && !marked("helper"); i++) usleep(10000);
  signal(SIGPIPE, SIG_IGN);
  for (;;) {
    int c = accept(s, NULL, NULL);
    if (c < 0) continue;
    char buf[2048];
    ssize_t n = read(c, buf, sizeof buf - 1);
    buf[n > 0 ? n : 0] = 0;
    char body[128];
    snprintf(body, sizeof body, "{\"ok\":true,\"port\":%d,\"pid\":%d}", port, (int)getpid());
    char out[512];
    int healthy = strncmp(buf, "GET /health ", 12) == 0;
    snprintf(out, sizeof out, "HTTP/1.1 %s\r\nContent-Type: application/json\r\nContent-Length: %zu\r\nConnection: close\r\n\r\n%s",
             healthy ? "200 OK" : "404 Not Found", healthy ? strlen(body) : 0, healthy ? body : "");
    write(c, out, strlen(out));
    close(c);
  }
}
