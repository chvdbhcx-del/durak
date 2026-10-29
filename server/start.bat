@echo off
cd /d "%~dp0"
if not exist node_modules call npm install --omit=dev
start "Дурак: сервер комнат" node index.mjs
where cloudflared >nul 2>nul
if %errorlevel%==0 (
  echo Адрес туннеля появится ниже в строке с trycloudflare.com
  cloudflared tunnel --url http://localhost:9000
) else (
  echo cloudflared не найден: сервер доступен только в вашей сети, http://IP-компьютера:9000
  pause
)
