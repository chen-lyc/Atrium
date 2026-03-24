#include "connection.h"
using namespace std;

unordered_map<int, unique_ptr<Connection>> conns;

queue<TaskResult> ready_queue;
mutex ready_mutex;