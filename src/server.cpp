#include "logger.h"
#include "main_reactor.h"
#include "server_utils.h"
#include <fcntl.h>
#include <signal.h>
#include <sys/wait.h>
using namespace std;

int main(int argc, char *argv[]) {
    signal(SIGINT, SIG_IGN);
    signal(SIGTERM, SIG_IGN);

    AsyncLogger::getInstance().setFilePath("logs/daemon.log");

    while (true) {
        pid_t pid = fork();
        if (pid > 0) {
            LOG_INFO("process start, pid is %d", static_cast<int>(pid));
            int status;
            waitpid(pid, &status, 0);

            if (WIFEXITED(status)) {
                LOG_INFO("\nserver stop");
                break;
            } else if (WIFSIGNALED(status)) {
                int sig = WTERMSIG(status);
                {
                    string msg;
                    msg.reserve(32);
                    msg += "pid = ";
                    msg += to_string(pid);
                    msg += ", process terminated by signal ";
                    msg += to_string(sig);
                    msg += ", restarting...";
                    LOG_INFO("%s", msg.c_str());
                }
                continue;
            }
        } else if (pid < 0) {
            LOG_ERROR("fork failed");
            sleep(1);
            continue;
        } else if (pid == 0) {
            LOG_INFO("\nserver starting");

            stopfd = eventfd(0, EFD_NONBLOCK);
            signal(SIGINT, handleSignal);
            signal(SIGTERM, handleSignal);
            signal(SIGPIPE, SIG_IGN);

            string ip = "127.0.0.1";
            int http_port = 8080;
            int protobuf_port = 9090;
            if (argc > 3) {
                ip = argv[1];
                http_port = stoi(argv[2]);
                protobuf_port = stoi(argv[3]);
            }

            if (argc > 4) {
                AsyncLogger::getInstance().setLevel(argv[4]);
            }

            MainReactor main_reactor(stopfd, ip, http_port, protobuf_port, 5, 1024);
            main_reactor.loop();

            return 0;
        }
    }
}
