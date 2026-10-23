// tree: a tracked server whose helpers leave its process group or its environment behind, for #236's cleanup
// criteria. Every process it makes writes a file <piddir>/<role>.<pid> before it does anything that hides it,
// so the test knows each PID without trusting the supervisor.
//
//   tree <piddir> split    AC10: forks helper "a", which calls setsid and keeps its environment (the run token),
//                          and helper "b", which execs /bin/sleep with an empty environment and stays in the
//                          run's group; once both have written their files, the server exits (PPID 1 for both)
//   tree <piddir> late     AC11: forks helper "h", which waits 100 ms, forks grandchild "g" and exits; "g" calls
//                          setsid and execs /bin/sleep with an empty environment. The server stays.
//   tree <piddir> all      both of the above under one server, which stays (the crash test)
#include <dirent.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

static const char *dir;

static void mark(const char *role) {
  char path[1024];
  snprintf(path, sizeof path, "%s/%s.%d", dir, role, (int)getpid());
  int fd = open(path, O_WRONLY | O_CREAT | O_TRUNC, 0644);
  if (fd >= 0) close(fd);
}

static void exec_bare_sleep(void) {
  char *argv[] = { "sleep", "600", NULL };
  char *envp[] = { NULL };
  execve("/bin/sleep", argv, envp);
  _exit(127);
}

/** Whether a file <role>.<pid> is in the folder yet. */
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

static void split(void) {
  if (fork() == 0) {             // a: its own session and group, the environment kept
    setsid();
    mark("a");
    for (;;) pause();
  }
  if (fork() == 0) {             // b: the run's group, no environment
    mark("b");
    exec_bare_sleep();
  }
}

static void late(void) {
  if (fork() == 0) {             // h: waits, forks g, exits
    mark("h");
    usleep(100000);
    if (fork() == 0) {           // g: its own session, no environment
      mark("g");
      setsid();
      exec_bare_sleep();
    }
    _exit(0);
  }
}

int main(int argc, char **argv) {
  if (argc != 3) { fprintf(stderr, "usage: tree <piddir> split|late|all\n"); return 2; }
  dir = argv[1];
  mark("server");
  if (strcmp(argv[2], "split") == 0) {
    split();
    for (int i = 0; i < 500 && !(marked("a") && marked("b")); i++) usleep(10000);
    return 0;
  }
  if (strcmp(argv[2], "late") == 0) late();
  else if (strcmp(argv[2], "all") == 0) { split(); late(); }
  else return 2;
  for (;;) pause();
}
