#!/bin/sh
# Launches both processes in one container:
#   1. The C++ WebSocket relay on an internal port (8090).
#   2. Caddy (foreground) serving the static site on $PORT and proxying
#      /ws to the relay. Caddy handles the WebSocket upgrade.
#
# The relay and Caddy must NOT share a port (both default to 8080), so the
# relay runs on 8090 internally.
set -e

/usr/local/bin/jump_server 8090 &
SERVER_PID=$!

# Take the relay down if the container is stopped.
trap 'kill "$SERVER_PID" 2>/dev/null || true' INT TERM

# Caddy in the foreground so its logs stream to Railway.
exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
