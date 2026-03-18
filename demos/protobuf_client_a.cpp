#include "../message.pb.h"
#include <arpa/inet.h>
#include <iostream>
#include <netinet/in.h>
#include <sys/socket.h>
#include <thread>
using namespace std;

#define BUFSIZE 4096

enum MsgType {
    MSG_LOGIN_REQ,
    MSG_LOGIN_RESP,
    MSG_REGISTER_REQ,
    MSG_REGISTER_RESP,
    MSG_CHAT_MSG,
    MSG_HEARTBEAT_MSG
};

void f(int fd) {
    uint32_t type = MSG_HEARTBEAT_MSG;
    uint32_t length = 0;

    string outbuf;
    outbuf.append(reinterpret_cast<char *>(&type), 4);
    outbuf.append(reinterpret_cast<char *>(&length), 4);

    while (1) {
        send(fd, outbuf.c_str(), outbuf.size(), 0);
        sleep(1);
    }
}

int main() {
    string ip = "127.0.0.1";
    int port = 9090;

    int fd = socket(PF_INET, SOCK_STREAM, 0);

    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_port = htons(port);
    inet_pton(AF_INET, ip.c_str(), &addr.sin_addr);

    connect(fd, reinterpret_cast<sockaddr *>(&addr), sizeof(addr));

    cout << "connect success" << endl;

    string sender_name = "xiaoxiao";
    string msg = "hello client b";

    ChatMessage req;
    req.set_sender_name(sender_name);
    req.set_msg(msg);

    string data;

    req.SerializeToString(&data);

    uint32_t msg_type = MSG_CHAT_MSG;
    uint32_t msg_length = data.size();

    string packet;
    packet.append(reinterpret_cast<char *>(&msg_type), 4);
    packet.append(reinterpret_cast<char *>(&msg_length), 4);
    packet.append(data);

    send(fd, packet.c_str(), packet.size(), 0);

    cout << "send over" << endl;

    thread t(f, fd);

    t.join();

    close(fd);

    return 0;
}