cmake_minimum_required(VERSION 3.10)
project(jump_prince_server CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

if(APPLE)
  # Native build, no special system libs needed (POSIX is in libc).
endif()

find_package(Threads REQUIRED)

add_executable(jump_server
  src/main.cpp
)

target_include_directories(jump_server PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/src)
target_link_libraries(jump_server PRIVATE Threads::Threads)
