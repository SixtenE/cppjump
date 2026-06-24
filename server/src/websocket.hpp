#pragma once
// Minimal RFC 6455 WebSocket server-side connection.
// Supports: handshake, text frames, ping/pong, close. No fragmentation
// of outbound frames (single FIN frames). Inbound continuation frames are
// concatenated. No external dependencies (POSIX sockets).
#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>

#include <cerrno>
#include <cstdint>
#include <cstring>
#include <mutex>
#include <string>
#include <vector>

#include "base64.hpp"
#include "sha1.hpp"

class WebSocket {
 public:
  explicit WebSocket(int fd) : fd_(fd) {}
  ~WebSocket() {
    if (fd_ >= 0) ::close(fd_);
  }
  WebSocket(const WebSocket&) = delete;
  WebSocket& operator=(const WebSocket&) = delete;

  // Perform the server-side HTTP -> WebSocket upgrade handshake.
  bool handshake() {
    std::string req;
    char buf[4096];
    while (true) {
      ssize_t n = ::recv(fd_, buf, sizeof(buf), 0);
      if (n <= 0) return false;
      req.append(buf, (size_t)n);
      if (req.find("\r\n\r\n") != std::string::npos) break;
      if (req.size() > 16384) return false;
    }

    // Locate Sec-WebSocket-Key (case-insensitive header name search).
    std::string lower = req;
    for (char& c : lower) {
      if (c >= 'A' && c <= 'Z') c = (char)(c - 'A' + 'a');
    }
    std::string needle = "sec-websocket-key:";
    auto pos = lower.find(needle);
    if (pos == std::string::npos) return false;
    size_t valStart = pos + needle.size();
    size_t valEnd = req.find("\r\n", valStart);
    if (valEnd == std::string::npos) return false;
    std::string key = req.substr(valStart, valEnd - valStart);
    size_t s = key.find_first_not_of(" \t");
    size_t e = key.find_last_not_of(" \t\r\n");
    if (s == std::string::npos) return false;
    key = key.substr(s, e - s + 1);

    std::string accept =
        base64::encode(sha1::hash(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"));

    std::string resp =
        "HTTP/1.1 101 Switching Protocols\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        "Sec-WebSocket-Accept: " +
        accept + "\r\n\r\n";
    return sendAll(resp.data(), resp.size()) == 0;
  }

  // Send a text frame. Thread-safe via a per-connection send mutex.
  void sendText(const std::string& payload) {
    std::vector<uint8_t> frame;
    frame.push_back(0x81);  // FIN + text opcode
    size_t len = payload.size();
    if (len <= 125) {
      frame.push_back((uint8_t)len);
    } else if (len <= 65535) {
      frame.push_back(126);
      frame.push_back((uint8_t)(len >> 8));
      frame.push_back((uint8_t)(len & 0xff));
    } else {
      frame.push_back(127);
      for (int i = 7; i >= 0; i--) frame.push_back((uint8_t)((len >> (8 * i)) & 0xff));
    }
    frame.insert(frame.end(), payload.begin(), payload.end());
    std::lock_guard<std::mutex> lk(sendMtx_);
    sendRaw(frame.data(), frame.size());
  }

  void sendClose() {
    uint8_t f[2] = {0x88, 0x00};
    std::lock_guard<std::mutex> lk(sendMtx_);
    sendRaw(f, 2);
  }

  // Read one complete message (concatenating continuation frames).
  // Returns false if the connection was closed or errored.
  bool recvMessage(std::string& out) {
    out.clear();
    while (true) {
      uint8_t hdr0, hdr1;
      if (!recvAll(&hdr0, 1)) return false;
      if (!recvAll(&hdr1, 1)) return false;
      bool fin = (hdr0 & 0x80) != 0;
      int opcode = hdr0 & 0x0f;
      bool masked = (hdr1 & 0x80) != 0;
      uint64_t len = hdr1 & 0x7f;
      if (len == 126) {
        uint8_t e[2];
        if (!recvAll(e, 2)) return false;
        len = ((uint64_t)e[0] << 8) | e[1];
      } else if (len == 127) {
        uint8_t e[8];
        if (!recvAll(e, 8)) return false;
        len = 0;
        for (int i = 0; i < 8; i++) len = (len << 8) | e[i];
      }
      uint8_t mask[4];
      if (masked && !recvAll(mask, 4)) return false;
      std::string payload((size_t)len, '\0');
      if (len > 0 && !recvAll(reinterpret_cast<uint8_t*>(payload.data()), (size_t)len))
        return false;
      if (masked) {
        for (size_t i = 0; i < payload.size(); i++) payload[i] = (char)((uint8_t)payload[i] ^ mask[i % 4]);
      }

      if (opcode == 0x8) {  // close
        sendClose();
        return false;
      } else if (opcode == 0x9) {  // ping -> pong
        sendPong(payload);
        continue;
      } else if (opcode == 0xA) {  // pong
        continue;
      } else if (opcode == 0x1 || opcode == 0x2 || opcode == 0x0) {
        out += payload;
        if (fin) return true;
      } else {
        // Unknown opcode; ignore.
        continue;
      }
    }
  }

  int fd() const { return fd_; }

 private:
  int fd_;
  std::mutex sendMtx_;

  int sendAll(const void* data, size_t n) {
    const char* p = (const char*)data;
    size_t sent = 0;
    while (sent < n) {
      ssize_t r = ::send(fd_, p + sent, n - sent, 0);
      if (r <= 0) {
        if (r < 0 && errno == EINTR) continue;
        return -1;
      }
      sent += (size_t)r;
    }
    return 0;
  }

  int sendRaw(const uint8_t* data, size_t n) { return sendAll(data, n); }

  bool recvAll(uint8_t* dst, size_t n) {
    size_t got = 0;
    while (got < n) {
      ssize_t r = ::recv(fd_, dst + got, n - got, 0);
      if (r < 0) {
        if (errno == EINTR) continue;
        return false;
      }
      if (r == 0) return false;
      got += (size_t)r;
    }
    return true;
  }

  void sendPong(const std::string& payload) {
    std::vector<uint8_t> f;
    f.push_back(0x8A);
    if (payload.size() <= 125) {
      f.push_back((uint8_t)payload.size());
    } else {
      // Pongs with >125 bytes are unusual; truncate.
      f.push_back(125);
    }
    size_t n = std::min(payload.size(), (size_t)125);
    f.insert(f.end(), payload.begin(), payload.begin() + n);
    std::lock_guard<std::mutex> lk(sendMtx_);
    sendRaw(f.data(), f.size());
  }
};
