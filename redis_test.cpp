#include <hiredis/hiredis.h>
#include <iostream>
using namespace std;

int main() {
    redisContext *c = redisConnect("127.0.0.1", 6379);
    if (c == nullptr || c->err) {
        cout << "连接失败" << endl;
        return -1;
    }

    // 写入
    redisReply *reply = (redisReply *)redisCommand(c, "SET mykey hello");
    freeReplyObject(reply);

    // 读取
    reply = (redisReply *)redisCommand(c, "GET mykey");
    cout << "mykey = " << reply->str << endl;
    freeReplyObject(reply);

    redisFree(c);
    return 0;
}