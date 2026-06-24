#pragma once
// Tiny JSON value + parser + serializer.
// Supports: null, bool, number (double), string, array, object.
// Sufficient for flat/nested game protocol messages.
#include <cmath>
#include <cstdint>
#include <map>
#include <memory>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

namespace json {

class Value;
using Object = std::map<std::string, Value>;
using Array = std::vector<Value>;

class Value {
 public:
  enum Type { Null, Bool, Number, String, ArrayT, ObjectT };

  Type type = Null;
  bool b = false;
  double num = 0.0;
  std::string str;
  std::shared_ptr<Array> arr;
  std::shared_ptr<Object> obj;

  Value() = default;

  static Value mkNull() { Value v; v.type = Null; return v; }
  static Value mkBool(bool x) { Value v; v.type = Bool; v.b = x; return v; }
  static Value mkNum(double x) { Value v; v.type = Number; v.num = x; return v; }
  static Value mkStr(const std::string& x) { Value v; v.type = String; v.str = x; return v; }
  static Value mkArr() { Value v; v.type = ArrayT; v.arr = std::make_shared<Array>(); return v; }
  static Value mkObj() { Value v; v.type = ObjectT; v.obj = std::make_shared<Object>(); return v; }

  bool isObj() const { return type == ObjectT; }
  bool isArr() const { return type == ArrayT; }
  bool isNum() const { return type == Number; }
  bool isStr() const { return type == String; }
  bool isBool() const { return type == Bool; }

  Value& operator[](const std::string& k) {
    if (type != ObjectT) *this = mkObj();
    return (*obj)[k];
  }

  const Value* find(const std::string& k) const {
    if (type != ObjectT || !obj) return nullptr;
    auto it = obj->find(k);
    if (it == obj->end()) return nullptr;
    return &it->second;
  }

  double asNum(double fallback = 0.0) const {
    return isNum() ? num : fallback;
  }
  bool asBool(bool fallback = false) const {
    return isBool() ? b : fallback;
  }
  const std::string& asStr(const std::string& fallback = "") const {
    static const std::string empty;
    return isStr() ? str : (fallback.empty() ? empty : fallback);
  }

  std::string serialize() const;
};

namespace detail {

inline void escapeString(std::ostringstream& o, const std::string& s) {
  o.put('"');
  for (char c : s) {
    switch (c) {
      case '"': o << "\\\""; break;
      case '\\': o << "\\\\"; break;
      case '\n': o << "\\n"; break;
      case '\r': o << "\\r"; break;
      case '\t': o << "\\t"; break;
      case '\b': o << "\\b"; break;
      case '\f': o << "\\f"; break;
      default:
        if (static_cast<uint8_t>(c) < 0x20) {
          o << "\\u" << std::hex << std::uppercase << (int)(uint8_t)c;
        } else {
          o.put(c);
        }
    }
  }
  o.put('"');
}

}  // namespace detail

inline std::string Value::serialize() const {
  std::ostringstream o;
  switch (type) {
    case Null: o << "null"; break;
    case Bool: o << (b ? "true" : "false"); break;
    case Number: {
      if (std::isfinite(num) && num == std::floor(num) &&
          std::fabs(num) < 1e15) {
        o << (long long)num;
      } else {
        o << num;
      }
      break;
    }
    case String: detail::escapeString(o, str); break;
    case ArrayT: {
      o.put('[');
      for (size_t i = 0; i < arr->size(); i++) {
        if (i) o.put(',');
        o << (*arr)[i].serialize();
      }
      o.put(']');
      break;
    }
    case ObjectT: {
      o.put('{');
      bool first = true;
      for (const auto& kv : *obj) {
        if (!first) o.put(',');
        first = false;
        detail::escapeString(o, kv.first);
        o.put(':');
        o << kv.second.serialize();
      }
      o.put('}');
      break;
    }
  }
  return o.str();
}

class Parser {
 public:
  explicit Parser(const std::string& src) : s_(src) {}

  Value parse() {
    skipWs();
    Value v = parseValue();
    skipWs();
    return v;
  }

 private:
  const std::string& s_;
  size_t i_ = 0;

  void skipWs() {
    while (i_ < s_.size()) {
      char c = s_[i_];
      if (c == ' ' || c == '\t' || c == '\n' || c == '\r') {
        i_++;
      } else {
        break;
      }
    }
  }

  char peek() {
    if (i_ >= s_.size()) throw std::runtime_error("JSON: unexpected end");
    return s_[i_];
  }

  char next() {
    if (i_ >= s_.size()) throw std::runtime_error("JSON: unexpected end");
    return s_[i_++];
  }

  void expect(char c) {
    char g = next();
    if (g != c) throw std::runtime_error("JSON: expected");
  }

  Value parseValue() {
    skipWs();
    char c = peek();
    if (c == '{') return parseObject();
    if (c == '[') return parseArray();
    if (c == '"') return parseString();
    if (c == 't' || c == 'f') return parseBool();
    if (c == 'n') return parseNull();
    return parseNumber();
  }

  Value parseObject() {
    expect('{');
    Value v = Value::mkObj();
    skipWs();
    if (peek() == '}') { next(); return v; }
    while (true) {
      skipWs();
      std::string key = parseString().str;
      skipWs();
      expect(':');
      Value val = parseValue();
      (*v.obj)[key] = val;
      skipWs();
      char c = next();
      if (c == ',') continue;
      if (c == '}') break;
      throw std::runtime_error("JSON: bad object");
    }
    return v;
  }

  Value parseArray() {
    expect('[');
    Value v = Value::mkArr();
    skipWs();
    if (peek() == ']') { next(); return v; }
    while (true) {
      Value val = parseValue();
      v.arr->push_back(val);
      skipWs();
      char c = next();
      if (c == ',') continue;
      if (c == ']') break;
      throw std::runtime_error("JSON: bad array");
    }
    return v;
  }

  Value parseString() {
    expect('"');
    std::string out;
    while (true) {
      char c = next();
      if (c == '"') break;
      if (c == '\\') {
        char e = next();
        switch (e) {
          case '"': out.push_back('"'); break;
          case '\\': out.push_back('\\'); break;
          case '/': out.push_back('/'); break;
          case 'n': out.push_back('\n'); break;
          case 'r': out.push_back('\r'); break;
          case 't': out.push_back('\t'); break;
          case 'b': out.push_back('\b'); break;
          case 'f': out.push_back('\f'); break;
          case 'u': {
            int cp = 0;
            for (int k = 0; k < 4; k++) {
              char h = next();
              cp <<= 4;
              if (h >= '0' && h <= '9') cp |= h - '0';
              else if (h >= 'a' && h <= 'f') cp |= h - 'a' + 10;
              else if (h >= 'A' && h <= 'F') cp |= h - 'A' + 10;
              else throw std::runtime_error("JSON: bad \\u");
            }
            if (cp < 0x80) {
              out.push_back((char)cp);
            } else if (cp < 0x800) {
              out.push_back((char)(0xC0 | (cp >> 6)));
              out.push_back((char)(0x80 | (cp & 0x3F)));
            } else {
              out.push_back((char)(0xE0 | (cp >> 12)));
              out.push_back((char)(0x80 | ((cp >> 6) & 0x3F)));
              out.push_back((char)(0x80 | (cp & 0x3F)));
            }
            break;
          }
          default: out.push_back(e); break;
        }
      } else {
        out.push_back(c);
      }
    }
    return Value::mkStr(out);
  }

  Value parseBool() {
    if (s_.compare(i_, 4, "true") == 0) { i_ += 4; return Value::mkBool(true); }
    if (s_.compare(i_, 5, "false") == 0) { i_ += 5; return Value::mkBool(false); }
    throw std::runtime_error("JSON: bad bool");
  }

  Value parseNull() {
    if (s_.compare(i_, 4, "null") == 0) { i_ += 4; return Value::mkNull(); }
    throw std::runtime_error("JSON: bad null");
  }

  Value parseNumber() {
    size_t start = i_;
    if (peek() == '-') i_++;
    while (i_ < s_.size() && ((s_[i_] >= '0' && s_[i_] <= '9'))) i_++;
    if (i_ < s_.size() && s_[i_] == '.') {
      i_++;
      while (i_ < s_.size() && (s_[i_] >= '0' && s_[i_] <= '9')) i_++;
    }
    if (i_ < s_.size() && (s_[i_] == 'e' || s_[i_] == 'E')) {
      i_++;
      if (i_ < s_.size() && (s_[i_] == '+' || s_[i_] == '-')) i_++;
      while (i_ < s_.size() && (s_[i_] >= '0' && s_[i_] <= '9')) i_++;
    }
    std::string numStr = s_.substr(start, i_ - start);
    try {
      return Value::mkNum(std::stod(numStr));
    } catch (...) {
      throw std::runtime_error("JSON: bad number");
    }
  }
};

inline Value parse(const std::string& s) {
  Parser p(s);
  return p.parse();
}

}  // namespace json
