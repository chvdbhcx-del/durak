// A tiny PeerJS signalling server: it only introduces players to each other,
// the cards themselves travel directly between phones.
import { PeerServer } from 'peer'

const port = Number(process.env.PORT) || 9000
const path = process.env.SERVER_PATH || '/'

PeerServer({ port, host: process.env.HOST || '0.0.0.0', path, allow_discovery: false, proxied: true, corsOptions: { origin: true } }, () => {
  console.log(`Сервер комнат запущен: порт ${port}, путь ${path}`)
})
