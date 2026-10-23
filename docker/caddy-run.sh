#!/bin/sh
# Every game runs on its own port (gameServer.firstGamePort + n) and clients connect to
# <scheme>://<game domain>:<port>/play. Caddyfile site addresses can't hold a port range,
# so this expands SURVEV_GAME_PORTS (e.g. 9000-9063) into one site address per port.
set -eu

first=${SURVEV_GAME_PORTS%-*}
last=${SURVEV_GAME_PORTS#*-}
sites=""
for port in $(seq "$first" "$last"); do
    sites="${sites:+$sites, }${SURVEV_SCHEME:-https}://${SURVEV_GAME_DOMAIN}:$port"
done
export SURVEV_GAME_PORT_SITES="$sites"

exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
