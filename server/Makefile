CXX ?= clang++
CXXFLAGS ?= -std=c++17 -O3 -flto -Wall -Wextra -pthread
TARGET := build/jump_server
SRC := src/main.cpp

.PHONY: all run clean test test-json test-relay

all: $(TARGET)

$(TARGET): $(SRC) src/websocket.hpp src/json.hpp src/sha1.hpp src/base64.hpp
	@mkdir -p build
	$(CXX) $(CXXFLAGS) -Isrc $(SRC) -o $(TARGET)

run: $(TARGET)
	./$(TARGET) 8080

build/test_json: test/test_json.cpp src/json.hpp
	@mkdir -p build
	$(CXX) -std=c++17 -O0 -g -Wall -Wextra -Isrc test/test_json.cpp -o build/test_json

test-json: build/test_json
	./build/test_json

test-relay: $(TARGET)
	python3 test/test_relay.py

test: test-json test-relay

clean:
	rm -rf build
