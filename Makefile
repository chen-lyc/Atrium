CXX = g++
CXXFLAGS = -std=c++17 -Wall -Wno-sign-compare -Iinclude

TARGET = build/server.out

SRCS = src/server.cpp src/connection.cpp src/epoll_utils.cpp src/http.cpp \
       src/http_codec.cpp src/logger.cpp src/mysql_pool.cpp src/redis_pool.cpp \
       src/protobuf_codec.cpp src/protocol.cpp src/task.cpp src/timerheap.cpp \
       src/utils.cpp src/message.pb.cc

LIBS = -lprotobuf -lmysqlclient -lhiredis -lpthread

$(TARGET): $(SRCS)
	g++ $(CXXFLAGS) $(SRCS) -o $(TARGET) $(LIBS)

clean:
	rm -f $(TARGET)