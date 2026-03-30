#include "connection.h"
using namespace std;

queue<TaskResult> ready_queue;
mutex ready_mutex;