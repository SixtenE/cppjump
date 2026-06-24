CXX ?= clang++
CXXFLAGS ?= -std=c++17 -O3 -flto -Wall -Wextra -pthread
TARGET := build/jump_server
SRC := src/main.cpp

.PHONY: all run clean

all: $(TARGET)

$(TARGET): $(SRC) src/websocket.hpp src/json.hpp src/sha1.hpp src/base64.hpp
	@mkdir -p build
	$(CXX) $(CXXFLAGS) -Isrc $(SRC) -o $(TARGET)

run: $(TARGET)
	./$(TARGET) 8080

clean:
	rm -rf build
