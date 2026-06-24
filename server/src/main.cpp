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

#include <arpa/inet.h>
#include <netinet/in.h>
#include <signal.h>
#include <sys/socket.h>
#include <unistd.h>

#include <atomic>
#include <chrono>
#include <cstdint>
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

struct Client {
  int id;
  std::string name;
  std::shared_ptr<WebSocket> ws;
  json::Value state;   // last reported state object (without id/name)
  bool hasState = false;
  bool saidHello = false;
};

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
              << " (snapshot " << kSnapshotHz << "Hz)" << std::endl;

    std::thread snapshotThr(&Server::snapshotLoop, this);

    while (running_) {
      sockaddr_in cli{};
      socklen_t cliLen = sizeof(cli);
      int fd = ::accept(listenFd_, (sockaddr*)&cli, &cliLen);
      if (fd < 0) {
        if (errno == EINTR) continue;
        perror("accept");
        continue;
      }
      std::thread(&Server::handleSession, this, fd).detach();
    }

    ::close(listenFd_);
  }

 private:
  int port_;
  int listenFd_ = -1;
  std::atomic<bool> running_{true};
  std::atomic<int> nextId_{1};

  std::mutex mtx_;
  std::vector<std::shared_ptr<Client>> clients_;

  // Build the player JSON entry for a client (id + name + reported state).
  json::Value playerJson(const Client& c) {
    json::Value v = json::Value::mkObj();
    v["id"] = json::Value::mkNum(c.id);
    v["name"] = json::Value::mkStr(c.name);
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
          if (c->saidHello) { any = true; break; }
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
    clients_.push_back(c);
    return c;
  }

  void removeClient(int id) {
    std::vector<std::shared_ptr<WebSocket>> toNotify;
    {
      std::lock_guard<std::mutex> lk(mtx_);
      for (auto it = clients_.begin(); it != clients_.end(); ++it) {
        if ((*it)->id == id) { clients_.erase(it); break; }
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

  void handleSession(int fd) {
    auto ws = std::make_shared<WebSocket>(fd);
    if (!ws->handshake()) {
      std::cerr << "Handshake failed for fd " << fd << std::endl;
      return;
    }

    auto client = addClient(ws);
    std::cout << "[+] client connected id=" << client->id << std::endl;

    std::string msg;
    while (ws->recvMessage(msg)) {
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
        const json::Value* nameV = v.find("name");
        std::string name = nameV ? nameV->asStr("Prince") : "Prince";
        if (name.empty()) name = "Prince";
        {
          std::lock_guard<std::mutex> lk(mtx_);
          client->name = name;
          client->saidHello = true;
        }
        sendInit(client);
        broadcastJoin(client);
      } else if (type == "state") {
        std::lock_guard<std::mutex> lk(mtx_);
        client->state = v;
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
