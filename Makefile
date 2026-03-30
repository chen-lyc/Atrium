CXX = g++
CXXFLAGS = -std=c++20 -Wall -Wno-sign-compare -Iinclude

TARGET = build/server.out

SRCS = src/server.cpp src/connection.cpp src/epoll_utils.cpp src/http.cpp \
       src/http_codec.cpp src/logger.cpp src/mysql_pool.cpp src/redis_pool.cpp \
       src/protobuf_codec.cpp src/protocol.cpp src/reactor.cpp src/timerheap.cpp \
       src/utils.cpp src/message.pb.cc

OBJS = $(SRCS:src/%.cpp=build/%.o)
OBJS := $(OBJS:src/%.cc=build/%.o)

LIBS = -lprotobuf -lmysqlclient -lhiredis -lpthread

$(TARGET): $(OBJS)
	$(CXX) $(OBJS) -o $(TARGET) $(LIBS)

build/%.o: src/%.cpp
	$(CXX) $(CXXFLAGS) -c $< -o $@

build/%.o: src/%.cc
	$(CXX) $(CXXFLAGS) -c $< -o $@

clean:
	rm -f $(TARGET) build/*.o