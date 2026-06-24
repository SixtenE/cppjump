#pragma once
// Minimal SHA-1 implementation (RFC 3174). No external dependencies.
#include <cstdint>
#include <cstring>
#include <vector>
#include <algorithm>

namespace sha1 {

inline uint32_t rol(uint32_t value, int bits) {
  return (value << bits) | (value >> (32 - bits));
}

struct Sha1 {
  uint32_t h[5] = {0x67452301u, 0xEFCDAB89u, 0x98BADCFEu, 0x10325476u, 0xC3D2E1F0u};
  uint8_t msg[64];
  uint64_t total = 0;
  size_t len = 0;

  void process() {
    uint32_t w[80];
    for (int i = 0; i < 16; i++) {
      w[i] = (uint32_t)msg[i * 4] << 24 | (uint32_t)msg[i * 4 + 1] << 16 |
             (uint32_t)msg[i * 4 + 2] << 8 | (uint32_t)msg[i * 4 + 3];
    }
    for (int i = 16; i < 80; i++) {
      w[i] = rol(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
    }
    uint32_t a = h[0], b = h[1], c = h[2], d = h[3], e = h[4];
    for (int i = 0; i < 80; i++) {
      uint32_t f, k;
      if (i < 20) { f = (b & c) | ((~b) & d); k = 0x5A827999u; }
      else if (i < 40) { f = b ^ c ^ d; k = 0x6ED9EBA1u; }
      else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDCu; }
      else { f = b ^ c ^ d; k = 0xCA62C1D6u; }
      uint32_t temp = rol(a, 5) + f + e + k + w[i];
      e = d; d = c; c = rol(b, 30); b = a; a = temp;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e;
  }

  void update(const uint8_t* data, size_t n) {
    total += n;
    while (n) {
      size_t take = std::min((size_t)(64 - len), n);
      std::memcpy(msg + len, data, take);
      len += take;
      data += take;
      n -= take;
      if (len == 64) { process(); len = 0; }
    }
  }

  std::vector<uint8_t> finish() {
    uint64_t bits = total * 8;
    const uint8_t one = 0x80;
    update(&one, 1);
    const uint8_t zero = 0x00;
    while (len != 56) update(&zero, 1);
    uint8_t lenb[8];
    for (int i = 0; i < 8; i++) lenb[i] = (uint8_t)(bits >> ((7 - i) * 8));
    update(lenb, 8);
    std::vector<uint8_t> out(20);
    for (int i = 0; i < 5; i++) {
      out[i * 4] = (uint8_t)(h[i] >> 24);
      out[i * 4 + 1] = (uint8_t)(h[i] >> 16);
      out[i * 4 + 2] = (uint8_t)(h[i] >> 8);
      out[i * 4 + 3] = (uint8_t)(h[i]);
    }
    return out;
  }
};

inline std::vector<uint8_t> hash(const std::string& s) {
  Sha1 h;
  h.update(reinterpret_cast<const uint8_t*>(s.data()), s.size());
  return h.finish();
}

}  // namespace sha1
