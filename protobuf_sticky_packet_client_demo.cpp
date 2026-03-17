#include "message.pb.h"
#include <arpa/inet.h>
#include <iostream>
#include <netinet/in.h>
#include <sys/socket.h>
using namespace std;

#define BUFSIZE 4096

enum MsgType {
    MSG_LOGIN_REQ,
    MSG_LOGIN_RESP,
    MSG_REGISTER_REQ,
    MSG_REGISTER_RESP
};

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

    packet.append(reinterpret_cast<char *>(&msg_type), 4);
    packet.append(reinterpret_cast<char *>(&msg_length), 4);
    packet.append(data);

    send(fd, packet.c_str(), packet.size(), 0);

    cout << "send over" << endl;

    sleep(1);

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

    close(fd);

    return 0;
}