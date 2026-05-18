CXX = g++
CXXFLAGS = -g -O0 -std=c++20 -Wall -Wno-sign-compare -I include -I third_party -fsanitize=address
DEPFLAGS = -MMD -MP

TARGET = build/server.out

SRCS = src/server.cpp src/message.pb.cc src/server_utils.cpp src/timerheap.cpp \
	   src/http_codec.cpp src/logger.cpp src/mysql_pool.cpp src/redis_pool.cpp \
	   src/protobuf_codec.cpp src/utils.cpp src/connection_route.cpp src/http_route.cpp src/sub_reactor.cpp src/memory_pool.cpp src/ai_client.cpp src/deepseek_client.cpp \
	   src/qwen_client.cpp \
	   src/websocket_codec.cpp src/main_reactor.cpp

OBJS = $(SRCS:src/%.cpp=build/%.o)
OBJS := $(OBJS:src/%.cc=build/%.o)
DEPS = $(OBJS:.o=.d)

LIBS = -lprotobuf -lmysqlclient -lhiredis -lpthread -lcrypto -lmysqlcppconn -lssl -fsanitize=address

$(TARGET): $(OBJS)
	$(CXX) $(OBJS) -o $(TARGET) $(LIBS)

build/%.o: src/%.cpp Makefile | build
	$(CXX) $(CXXFLAGS) $(DEPFLAGS) -c $< -o $@

build/%.o: src/%.cc Makefile | build
	$(CXX) $(CXXFLAGS) $(DEPFLAGS) -c $< -o $@

build:
	mkdir -p build

clean:
	rm -f $(TARGET) build/*.o build/*.d

-include $(DEPS)
