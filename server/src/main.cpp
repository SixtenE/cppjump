// Jump Prince multiplayer WebSocket server.
//
// Protocol (JSON over text frames):
//   Client -> Server:
//     {"type":"hello","name":"..."}                       (once, on connect)
//     {"type":"state", position:{x,y}, velocity:{x,y},
//      facing:bool, onGround:bool, animTime:num,
//      sprite:int, screen:int}                            (frequent, ~20Hz)
//   Server -> Client:
//     {"type":"init","id":int,"players":[ player, ... ]}  (once, on connect)
//     {"type":"snapshot","players":[ player, ... ]}       (broadcast ~20Hz)
//     {"type":"join","player": player}                    (when someone joins)
//     {"type":"leave","id":int}                           (when someone leaves)
//
//   player = {id,name,position:{x,y},velocity:{x,y},
//             facing,onGround,animTime,sprite,screen}
//
// Model: client-authoritative. Each client simulates its own player and
// reports its state; the server relays snapshots to everyone else.
// Identity (id/name) is assigned by the server and cannot be overwritten
// by a client's state payload.

#include <arpa/inet.h>
#include <netinet/in.h>
#include <signal.h>
#include <sys/socket.h>
#include <sys/time.h>
#include <unistd.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <iostream>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include "json.hpp"
#include "websocket.hpp"

namespace {

constexpr int kDefaultPort = 8080;
constexpr int kSnapshotHz = 20;
constexpr int kMaxClients = 32;
constexpr int kRecvTimeoutSec = 15;
constexpr size_t kMaxNameLen = 24;
constexpr double kMsgPerSec = 40.0;
constexpr double kMsgBurst = 40.0;

struct Client {
  int id;
  std::string name;
  std::shared_ptr<WebSocket> ws;
  json::Value state;  // last reported state (whitelisted fields only)
  bool hasState = false;
  bool saidHello = false;
};

std::string sanitizeName(std::string name) {
  std::string out;
  out.reserve(std::min(name.size(), kMaxNameLen));
  for (unsigned char c : name) {
    if (c < 0x20 || c == 0x7f) continue;
    out.push_back(static_cast<char>(c));
    if (out.size() >= kMaxNameLen) break;
  }
  // Drop a trailing incomplete UTF-8 sequence after byte truncation.
  if (!out.empty()) {
    size_t i = out.size();
    size_t cont = 0;
    while (i > 0 && (static_cast<unsigned char>(out[i - 1]) & 0xC0) == 0x80) {
      i--;
      cont++;
    }
    if (i == 0) {
      out.clear();
    } else {
      unsigned char lead = static_cast<unsigned char>(out[i - 1]);
      int need = 1;
      if ((lead & 0x80) == 0) need = 1;
      else if ((lead & 0xE0) == 0xC0) need = 2;
      else if ((lead & 0xF0) == 0xE0) need = 3;
      else if ((lead & 0xF8) == 0xF0) need = 4;
      else need = 99;  // invalid lead
      if (cont + 1 < static_cast<size_t>(need)) out.resize(i - 1);
    }
  }
  size_t start = 0;
  while (start < out.size() && out[start] == ' ') start++;
  size_t end = out.size();
  while (end > start && out[end - 1] == ' ') end--;
  out = out.substr(start, end - start);
  if (out.empty()) return "Prince";
  return out;
}

double finiteNum(const json::Value* v, double fallback = 0.0) {
  if (!v || !v->isNum() || !std::isfinite(v->num)) return fallback;
  return v->num;
}

json::Value extractVec2(const json::Value* v) {
  json::Value o = json::Value::mkObj();
  o["x"] = json::Value::mkNum(finiteNum(v && v->isObj() ? v->find("x") : nullptr));
  o["y"] = json::Value::mkNum(finiteNum(v && v->isObj() ? v->find("y") : nullptr));
  return o;
}

// Copy only the protocol state fields. Extra keys (including id/name/type)
// are dropped so a client cannot impersonate another player or inflate
// snapshots with arbitrary JSON.
json::Value extractState(const json::Value& msg) {
  json::Value s = json::Value::mkObj();
  s["position"] = extractVec2(msg.find("position"));
  s["velocity"] = extractVec2(msg.find("velocity"));

  bool facing = true;
  if (const json::Value* v = msg.find("facing")) {
    if (v->isBool()) facing = v->b;
  }
  s["facing"] = json::Value::mkBool(facing);

  bool onGround = false;
  if (const json::Value* v = msg.find("onGround")) {
    if (v->isBool()) onGround = v->b;
  }
  s["onGround"] = json::Value::mkBool(onGround);

  s["animTime"] = json::Value::mkNum(finiteNum(msg.find("animTime")));

  int sprite = 0;
  if (const json::Value* v = msg.find("sprite")) {
    double n = finiteNum(v, 0);
    sprite = static_cast<int>(n);
    if (sprite < 0) sprite = 0;
    if (sprite > 32) sprite = 32;
  }
  s["sprite"] = json::Value::mkNum(sprite);

  int screen = 0;
  if (const json::Value* v = msg.find("screen")) {
    double n = finiteNum(v, 0);
    screen = static_cast<int>(n);
    if (screen < -8) screen = -8;
    if (screen > 64) screen = 64;
  }
  s["screen"] = json::Value::mkNum(screen);
  return s;
}

class Server {
 public:
  explicit Server(int port) : port_(port) {}

  void run() {
    listenFd_ = ::socket(AF_INET, SOCK_STREAM, 0);
    if (listenFd_ < 0) {
      perror("socket");
      return;
    }
    int yes = 1;
    setsockopt(listenFd_, SOL_SOCKET, SO_REUSEADDR, &yes, sizeof(yes));

    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = htonl(INADDR_ANY);
    addr.sin_port = htons((uint16_t)port_);
    if (::bind(listenFd_, (sockaddr*)&addr, sizeof(addr)) < 0) {
      perror("bind");
      return;
    }
    if (::listen(listenFd_, 64) < 0) {
      perror("listen");
      return;
    }

    std::cout << "Jump Prince server listening on ws://0.0.0.0:" << port_
              << " (snapshot " << kSnapshotHz << "Hz, max " << kMaxClients
              << " clients)" << std::endl;

    std::thread(&Server::snapshotLoop, this).detach();

    while (running_) {
      sockaddr_in cli{};
      socklen_t cliLen = sizeof(cli);
      int fd = ::accept(listenFd_, (sockaddr*)&cli, &cliLen);
      if (fd < 0) {
        if (errno == EINTR) continue;
        perror("accept");
        continue;
      }
      int prev = liveThreads_.fetch_add(1);
      if (prev >= kMaxClients) {
        liveThreads_.fetch_sub(1);
        ::close(fd);
        continue;
      }
      std::thread([this, fd]() {
        struct Decrement {
          std::atomic<int>& n;
          ~Decrement() { n.fetch_sub(1); }
        } guard{liveThreads_};
        handleSession(fd);
      }).detach();
    }

    ::close(listenFd_);
  }

 private:
  int port_;
  int listenFd_ = -1;
  std::atomic<bool> running_{true};
  std::atomic<int> nextId_{1};
  std::atomic<int> liveThreads_{0};

  std::mutex mtx_;
  std::vector<std::shared_ptr<Client>> clients_;

  // Build the player JSON entry. Server-owned id/name are applied last so
  // a copied state object can never overwrite identity.
  json::Value playerJson(const Client& c) {
    json::Value v = json::Value::mkObj();
    if (c.hasState && c.state.isObj()) {
      for (const auto& kv : *c.state.obj) v[kv.first] = kv.second;
    } else {
      v["position"] = json::Value::mkObj();
      v["position"]["x"] = json::Value::mkNum(0);
      v["position"]["y"] = json::Value::mkNum(0);
      v["velocity"] = json::Value::mkObj();
      v["velocity"]["x"] = json::Value::mkNum(0);
      v["velocity"]["y"] = json::Value::mkNum(0);
      v["facing"] = json::Value::mkBool(true);
      v["onGround"] = json::Value::mkBool(false);
      v["animTime"] = json::Value::mkNum(0);
      v["sprite"] = json::Value::mkNum(0);
      v["screen"] = json::Value::mkNum(0);
    }
    // Applied last so a copied state object can never overwrite identity.
    v["id"] = json::Value::mkNum(c.id);
    v["name"] = json::Value::mkStr(c.name);
    return v;
  }

  // Build snapshot assuming the caller already holds mtx_.
  json::Value snapshotJsonLocked() {
    json::Value arr = json::Value::mkArr();
    for (const auto& c : clients_) {
      if (!c->saidHello) continue;
      arr.arr->push_back(playerJson(*c));
    }
    json::Value root = json::Value::mkObj();
    root["type"] = json::Value::mkStr("snapshot");
    root["players"] = arr;
    return root;
  }

  void snapshotLoop() {
    auto period = std::chrono::milliseconds(1000 / kSnapshotHz);
    while (running_) {
      std::this_thread::sleep_for(period);
      json::Value snap;
      std::vector<std::shared_ptr<WebSocket>> targets;
      {
        std::lock_guard<std::mutex> lk(mtx_);
        bool any = false;
        for (const auto& c : clients_) {
          if (c->saidHello) {
            any = true;
            break;
          }
        }
        if (!any) continue;
        snap = snapshotJsonLocked();
        for (const auto& c : clients_) {
          if (c->saidHello) targets.push_back(c->ws);
        }
      }
      std::string payload = snap.serialize();
      for (auto& ws : targets) ws->sendText(payload);
    }
  }

  std::shared_ptr<Client> addClient(std::shared_ptr<WebSocket> ws) {
    auto c = std::make_shared<Client>();
    c->id = nextId_.fetch_add(1);
    c->ws = ws;
    std::lock_guard<std::mutex> lk(mtx_);
    if (static_cast<int>(clients_.size()) >= kMaxClients) return nullptr;
    clients_.push_back(c);
    return c;
  }

  void removeClient(int id) {
    std::vector<std::shared_ptr<WebSocket>> toNotify;
    {
      std::lock_guard<std::mutex> lk(mtx_);
      for (auto it = clients_.begin(); it != clients_.end(); ++it) {
        if ((*it)->id == id) {
          clients_.erase(it);
          break;
        }
      }
      for (const auto& c : clients_) {
        if (c->saidHello) toNotify.push_back(c->ws);
      }
    }
    json::Value msg = json::Value::mkObj();
    msg["type"] = json::Value::mkStr("leave");
    msg["id"] = json::Value::mkNum(id);
    std::string payload = msg.serialize();
    for (auto& ws : toNotify) ws->sendText(payload);
  }

  static void setSocketTimeouts(int fd) {
    timeval tv{};
    tv.tv_sec = kRecvTimeoutSec;
    tv.tv_usec = 0;
    setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));
    setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof(tv));
  }

  void handleSession(int fd) {
    setSocketTimeouts(fd);
    auto ws = std::make_shared<WebSocket>(fd);
    if (!ws->handshake()) {
      std::cerr << "Handshake failed for fd " << fd << std::endl;
      return;
    }

    auto client = addClient(ws);
    if (!client) {
      std::cerr << "[!] server full, rejecting connection" << std::endl;
      ws->sendClose();
      return;
    }
    std::cout << "[+] client connected id=" << client->id << std::endl;

    using clock = std::chrono::steady_clock;
    auto lastRefill = clock::now();
    double tokens = kMsgBurst;

    auto allowMessage = [&]() {
      auto now = clock::now();
      double elapsed = std::chrono::duration<double>(now - lastRefill).count();
      lastRefill = now;
      tokens = std::min(kMsgBurst, tokens + elapsed * kMsgPerSec);
      if (tokens < 1.0) return false;
      tokens -= 1.0;
      return true;
    };

    std::string msg;
    while (ws->recvMessage(msg)) {
      if (!allowMessage()) continue;
      json::Value v;
      try {
        v = json::Parser(msg).parse();
      } catch (const std::exception& e) {
        std::cerr << "[!] bad JSON from id=" << client->id << ": " << e.what()
                  << std::endl;
        continue;
      }
      const json::Value* typeV = v.find("type");
      if (!typeV || !typeV->isStr()) continue;
      const std::string& type = typeV->str;

      if (type == "hello") {
        bool already = false;
        {
          std::lock_guard<std::mutex> lk(mtx_);
          already = client->saidHello;
        }
        if (already) continue;  // ignore rename / duplicate join

        const json::Value* nameV = v.find("name");
        std::string name = sanitizeName(nameV ? nameV->asStr("Prince") : "Prince");
        {
          std::lock_guard<std::mutex> lk(mtx_);
          client->name = name;
          client->saidHello = true;
        }
        sendInit(client);
        broadcastJoin(client);
      } else if (type == "state") {
        std::lock_guard<std::mutex> lk(mtx_);
        if (!client->saidHello) continue;
        client->state = extractState(v);
        client->hasState = true;
      }
    }

    std::cout << "[-] client disconnected id=" << client->id << std::endl;
    removeClient(client->id);
  }

  void sendInit(const std::shared_ptr<Client>& self) {
    json::Value root = json::Value::mkObj();
    root["type"] = json::Value::mkStr("init");
    root["id"] = json::Value::mkNum(self->id);
    json::Value arr = json::Value::mkArr();
    {
      std::lock_guard<std::mutex> lk(mtx_);
      for (const auto& c : clients_) {
        if (c->id == self->id) continue;
        if (!c->saidHello) continue;
        arr.arr->push_back(playerJson(*c));
      }
    }
    root["players"] = arr;
    self->ws->sendText(root.serialize());
  }

  void broadcastJoin(const std::shared_ptr<Client>& self) {
    json::Value root = json::Value::mkObj();
    root["type"] = json::Value::mkStr("join");
    {
      std::lock_guard<std::mutex> lk(mtx_);
      root["player"] = playerJson(*self);
    }
    std::string payload = root.serialize();
    std::vector<std::shared_ptr<WebSocket>> targets;
    {
      std::lock_guard<std::mutex> lk(mtx_);
      for (const auto& c : clients_) {
        if (c->id == self->id) continue;
        if (c->saidHello) targets.push_back(c->ws);
      }
    }
    for (auto& ws : targets) ws->sendText(payload);
  }
};

}  // namespace

int main(int argc, char** argv) {
  signal(SIGPIPE, SIG_IGN);
  int port = kDefaultPort;
  if (argc > 1) port = std::atoi(argv[1]);
  Server server(port);
  server.run();
  return 0;
}
