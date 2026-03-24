#include "http.h"
using namespace std;

const string body = "Hello";
const string default_response = "HTTP/1.1 200 OK\r\nContent-Length: " + to_string(body.size()) + "\r\n\r\n" + body;
const string error_response = "HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n";