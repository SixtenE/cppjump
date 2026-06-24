# syntax=docker/dockerfile:1
#
# Single-container deployment for Jump Prince.
#   - Builds the Vite/Phaser web client  -> /srv/web (static)
#   - Builds the C++17 WebSocket relay   -> /usr/local/bin/jump_server
#   - Runtime: Caddy serves the static site on $PORT and reverse-proxies
#     /ws to the C++ relay on 127.0.0.1:8080 (Caddy handles WS upgrade).
#
# Everything is built against Alpine/musl so the compiled binary matches
# the runtime libc.

# ---- 1. Build the web client ----
FROM node:20-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ---- 2. Build the C++ server ----
FROM alpine:3.20 AS server
RUN apk add --no-cache build-base
WORKDIR /server
COPY server/ ./
RUN make CXX=g++

# ---- 3. Runtime: Caddy + C++ relay ----
FROM caddy:2-alpine AS runtime
# Clear Caddy's default ENTRYPOINT so our launcher script is what runs.
ENTRYPOINT []

# C++ binary is dynamically linked against libstdc++/libgcc; Caddy's base
# image doesn't ship those, so install them here (static Caddy is unaffected).
RUN apk add --no-cache libstdc++ libgcc

# Built static site
COPY --from=web /web/dist /srv/web
# Compiled relay server
COPY --from=server /server/build/jump_server /usr/local/bin/jump_server
# Caddy config + process launcher
COPY Caddyfile /etc/caddy/Caddyfile
COPY start.sh  /start.sh
RUN chmod +x /start.sh

EXPOSE 8080
CMD ["/start.sh"]
