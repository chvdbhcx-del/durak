#!/usr/bin/env bash
# Starts the room server and, when cloudflared is installed, a free public https tunnel to it.
cd "$(dirname "$0")"
[ -d node_modules ] || npm install --omit=dev
PORT="${PORT:-9000}" node index.mjs &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT
if command -v cloudflared >/dev/null; then
  echo "Ищем адрес туннеля, он появится ниже в строке с trycloudflare.com"
  cloudflared tunnel --url "http://localhost:${PORT:-9000}"
else
  echo "cloudflared не найден: сервер доступен только в вашей сети (http://IP-компьютера:${PORT:-9000})."
  wait $SERVER
fi
