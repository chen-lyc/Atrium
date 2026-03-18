#include "message.pb.h"
#include <iostream>

using namespace std;

int main() {
    LoginRequest req;
    req.set_username("xiaoxiao");
    req.set_password("123");

    string data;
    req.SerializeToString(&data);
    cout << "序列化后大小：" << data.size() << " 字节" << endl;

    LoginRequest req2;
    req2.ParseFromString(data);
    cout << "username: " << req2.username() << endl;
    cout << "password: " << req2.password() << endl;

    return 0;
}