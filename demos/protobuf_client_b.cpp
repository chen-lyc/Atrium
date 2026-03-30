#include "message.pb.h"
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

    string username = "xiaoxiao";
    string password = "123";

    LoginRequest req;
    req.set_password(password);
    req.set_username(username);

    string data;

    req.SerializeToString(&data);

    uint32_t msg_type = MSG_LOGIN_REQ;
    uint32_t msg_length = data.size();

    string packet;
    packet.append(reinterpret_cast<char *>(&msg_type), 4);
    packet.append(reinterpret_cast<char *>(&msg_length), 4);
    packet.append(data);

    send(fd, packet.c_str(), packet.size(), 0);

    cout << "send over" << endl;

    string inbuf;
    inbuf.resize(BUFSIZE, '\0');
    int ret = recv(fd, inbuf.data(), BUFSIZE, 0);
    inbuf.resize(ret);

    cout << "read data size is " << ret << endl;

    while (!inbuf.empty()) {
        if (inbuf.size() < 8) {
            cout << "incomplete" << endl;
            close(fd);
            return 0;
        }

        uint32_t type;
        memcpy(&type, inbuf.c_str(), 4);

        uint32_t length;
        memcpy(&length, inbuf.c_str() + 4, 4);

        cout << type << " " << length << " ";

        data = inbuf.substr(8, length);

        LoginResponse resp;
        resp.ParseFromString(data);

        cout << "msg: " << resp.msg() << endl;
        inbuf.erase(inbuf.begin(), inbuf.begin() + 8 + length);
    }

    thread t(f, fd);

    cout << "start to read boardcast" << endl;

    inbuf.resize(BUFSIZE, '\0');
    ret = recv(fd, inbuf.data(), BUFSIZE, 0);
    inbuf.resize(ret);

    cout << "read data size is " << ret << endl;

    while (!inbuf.empty()) {
        if (inbuf.size() < 8) {
            cout << "incomplete" << endl;
            close(fd);
            return 0;
        }

        uint32_t type;
        memcpy(&type, inbuf.c_str(), 4);

        uint32_t length;
        memcpy(&length, inbuf.c_str() + 4, 4);

        cout << type << " " << length << " ";

        data = inbuf.substr(8, length);

        ChatMessage resp;
        resp.ParseFromString(data);

        cout << "sender_name: " << resp.sender_name() << endl;
        cout << "msg: " << resp.msg() << endl;
        inbuf.erase(inbuf.begin(), inbuf.begin() + 8 + length);
    }

    t.join();

    close(fd);

    return 0;
}