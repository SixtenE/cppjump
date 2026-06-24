// Benchmark for the server's snapshot hot path.
//
// Replicates exactly what Server::snapshotLoop() does each tick (20Hz):
//   1. Build a snapshot json::Value tree from per-client state (playerJson)
//   2. Serialize it to a string (Value::serialize)
//
// Usage: ./bench_json [players] [iterations]
//   players    - number of connected clients (default 10)
//   iterations - number of snapshot builds+serializes (default 100000)
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>

#include "json.hpp"

// Replicates Server::playerJson(): id + name + the client's last reported
// state object (which in the real server is the parsed "state" message).
static json::Value makePlayerState(int id, const std::string& name) {
  // This mirrors what a client sends as a "state" message:
  json::Value state = json::Value::mkObj();
  state["type"] = json::Value::mkStr("state");
  state["position"] = json::Value::mkObj();
  state["position"]["x"] = json::Value::mkNum(12.345);
  state["position"]["y"] = json::Value::mkNum(67.890);
  state["velocity"] = json::Value::mkObj();
  state["velocity"]["x"] = json::Value::mkNum(1.5);
  state["velocity"]["y"] = json::Value::mkNum(-3.2);
  state["facing"] = json::Value::mkBool(true);
  state["onGround"] = json::Value::mkBool(false);
  state["animTime"] = json::Value::mkNum(0.123);
  state["sprite"] = json::Value::mkNum(3);
  state["screen"] = json::Value::mkNum(1);

  // This mirrors playerJson(): id + name + copied state fields.
  json::Value v = json::Value::mkObj();
  v["id"] = json::Value::mkNum(id);
  v["name"] = json::Value::mkStr(name);
  if (state.isObj()) {
    for (const auto& kv : *state.obj) v[kv.first] = kv.second;
  }
  return v;
}

// Replicates Server::snapshotJsonLocked(): array of players + type field.
static json::Value buildSnapshot(const std::vector<json::Value>& states) {
  json::Value arr = json::Value::mkArr();
  for (const auto& s : states) arr.arr->push_back(s);
  json::Value root = json::Value::mkObj();
  root["type"] = json::Value::mkStr("snapshot");
  root["players"] = arr;
  return root;
}

int main(int argc, char** argv) {
  int players = argc > 1 ? std::atoi(argv[1]) : 10;
  int iters = argc > 2 ? std::atoi(argv[2]) : 100000;

  std::vector<json::Value> states;
  states.reserve(players);
  for (int i = 0; i < players; i++) {
    states.push_back(makePlayerState(i + 1, "Prince" + std::to_string(i)));
  }

  // Warmup (let the allocator settle, etc.)
  for (int i = 0; i < 1000; i++) {
    json::Value snap = buildSnapshot(states);
    std::string s = snap.serialize();
    (void)s;
  }

  auto t0 = std::chrono::high_resolution_clock::now();
  std::string last;
  for (int it = 0; it < iters; it++) {
    json::Value snap = buildSnapshot(states);
    last = snap.serialize();
  }
  auto t1 = std::chrono::high_resolution_clock::now();

  double ms = std::chrono::duration<double, std::milli>(t1 - t0).count();
  double perCallUs = (ms * 1000.0) / iters;
  double callsPerSec = iters / (ms / 1000.0);

  std::printf("=== Snapshot serialize benchmark ===\n");
  std::printf("players=%d  iterations=%d\n", players, iters);
  std::printf("total time:        %.2f ms\n", ms);
  std::printf("per snapshot:      %.3f us  (%.4f ms)\n", perCallUs, perCallUs / 1000.0);
  std::printf("snapshots/sec:     %.0f\n", callsPerSec);
  std::printf("snapshot size:     %zu bytes\n", last.size());
  std::printf("throughput:        %.2f MB/s\n",
              (last.size() * callsPerSec) / (1024.0 * 1024.0));
  std::printf("sample: %.80s...\n", last.c_str());
  return 0;
}
