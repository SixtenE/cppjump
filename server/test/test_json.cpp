// Unit tests for json.hpp parser limits and asStr-by-value.
#include <cstdio>
#include <stdexcept>
#include <string>

#include "json.hpp"

static int gFails = 0;

#define CHECK(cond)                                                             \
  do {                                                                          \
    if (!(cond)) {                                                              \
      std::fprintf(stderr, "FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond);      \
      gFails++;                                                                 \
    }                                                                           \
  } while (0)

static void expectThrow(const char* label, const std::string& src) {
  try {
    json::Parser(src).parse();
    std::fprintf(stderr, "FAIL %s: expected throw\n", label);
    gFails++;
  } catch (const std::exception&) {
    // ok
  }
}

int main() {
  {
    json::Value v = json::parse(R"({"type":"hello","name":"Ada"})");
    CHECK(v.isObj());
    CHECK(v.find("type") && v.find("type")->asStr() == "hello");
    CHECK(v.find("name") && v.find("name")->asStr() == "Ada");
  }

  {
    json::Value n = json::Value::mkNum(3);
    std::string s = n.asStr("Prince");
    CHECK(s == "Prince");
    json::Value empty;
    CHECK(empty.asStr("fallback") == "fallback");
  }

  {
    json::Value v = json::parse(R"({"position":{"x":1.5,"y":-2}})");
    const json::Value* p = v.find("position");
    CHECK(p && p->isObj());
    CHECK(p->find("x") && p->find("x")->asNum() == 1.5);
  }

  {
    std::string nested;
    for (int i = 0; i < 20; i++) nested.push_back('{');
    nested += "\"a\":1";
    for (int i = 0; i < 20; i++) nested.push_back('}');
    expectThrow("too nested object", nested);
  }

  {
    std::string longStr = "\"";
    longStr.append(2000, 'a');
    longStr.push_back('"');
    expectThrow("string too long", longStr);
  }

  {
    std::string obj = "{";
    for (int i = 0; i < 80; i++) {
      if (i) obj += ',';
      obj += "\"k" + std::to_string(i) + "\":1";
    }
    obj += '}';
    expectThrow("object too large", obj);
  }

  expectThrow("raw control", "\"\x01\"");
  expectThrow("number too long", std::string(80, '1'));

  {
    json::Value v = json::parse("{\"ok\":true}");
    std::string s = v.serialize();
    CHECK(s.find("\"ok\":true") != std::string::npos);
  }

  // A surrogate pair must combine into one 4-byte UTF-8 code point (U+1F3AE).
  {
    json::Value v = json::parse("\"\\uD83C\\uDFAE\"");
    CHECK(v.isStr());
    const std::string& s = v.str;
    CHECK(s.size() == 4);
    CHECK((unsigned char)s[0] == 0xF0 && (unsigned char)s[1] == 0x9F &&
          (unsigned char)s[2] == 0x8E && (unsigned char)s[3] == 0xAE);
  }

  // A lone high surrogate must become U+FFFD (EF BF BD), never a raw
  // lone-surrogate byte sequence (which would be invalid UTF-8).
  {
    json::Value v = json::parse("\"\\uD800x\"");
    CHECK(v.isStr());
    const std::string& s = v.str;
    CHECK(s.size() == 4);
    CHECK((unsigned char)s[0] == 0xEF && (unsigned char)s[1] == 0xBF &&
          (unsigned char)s[2] == 0xBD && s[3] == 'x');
  }

  // A lone low surrogate must also become U+FFFD.
  {
    json::Value v = json::parse("\"\\uDC00\"");
    CHECK(v.isStr());
    const std::string& s = v.str;
    CHECK(s.size() == 3);
    CHECK((unsigned char)s[0] == 0xEF && (unsigned char)s[1] == 0xBF &&
          (unsigned char)s[2] == 0xBD);
  }

  if (gFails) {
    std::fprintf(stderr, "%d check(s) failed\n", gFails);
    return 1;
  }
  std::printf("test_json: ok\n");
  return 0;
}
