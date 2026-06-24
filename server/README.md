# Jump Prince — Multiplayer Server

A small, dependency-free C++17 WebSocket server that relays player state
between clients, turning the single-player HTML game into a multiplayer one.

The server is intentionally simple: it is **not** authoritative over physics.
Each client simulates its own prince and reports its state (`position`,
`velocity`, facing, sprite, …) to the server at ~20 Hz. The server collects
these states and broadcasts a `snapshot` of all players to every client at
~20 Hz. Remote princes are rendered with light interpolation.

## Build

You need a C++17 compiler (`clang++` or `g++`). No external libraries.

```sh
make            # builds build/jump_server
# or, if you have cmake:
cmake -B build -DCMAKE_BUILD_TYPE=Release && cmake --build build
```

## Run

```sh
./build/jump_server            # default port 8080
./build/jump_server 8081       # custom port
```

## Protocol (JSON over WebSocket text frames)

Client → Server:
```jsonc
{ "type": "hello", "name": "Prince" }                                   // once
{ "type": "state", "position": {"x":..,"y":..}, "velocity": {"x":..,"y":..},
  "facing": true, "onGround": true, "animTime": 0.0,
  "sprite": 3, "screen": 1 }                                            // ~20Hz
```

Server → Client:
```jsonc
{ "type": "init",    "id": 1, "players": [ player, ... ] }   // once, on connect
{ "type": "snapshot","players": [ player, ... ] }            // ~20Hz broadcast
{ "type": "join",    "player": player }                      // when someone joins
{ "type": "leave",   "id": 2 }                               // when someone leaves
```

where `player` is:
```jsonc
{ "id": 1, "name": "Prince", "position": {"x":..,"y":..},
  "velocity": {"x":..,"y":..}, "facing": true, "onGround": true,
  "animTime": 0.0, "sprite": 3, "screen": 1 }
```

## Files

- `src/main.cpp`        — server: accept loop, per-client threads, relay/broadcast logic
- `src/websocket.hpp`   — minimal RFC 6455 server-side WebSocket (handshake, framing, ping/pong)
- `src/sha1.hpp`        — SHA-1 (for the handshake accept key)
- `src/base64.hpp`      — Base64 encoder
- `src/json.hpp`        — tiny JSON parser/serializer

## Running the game against it

From `web/`:

```sh
npm run dev      # vite dev server on http://localhost:5173
```

Open the page in two browser windows. On load you'll be asked for a name,
then the client connects to `ws://localhost:8080` and you'll see the other
player's prince moving in real time. To use a different server port, append
`?port=8081` to the game URL.
