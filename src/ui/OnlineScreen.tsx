import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import { maxPlayers } from '../engine/game'
import { CODE_LENGTH, normalizeCode } from '../net/room'
import type { Online } from '../net/useOnline'
import { BackButton } from './PlayScreen'
import { BOT_NAMES, DeckPicker, Group, ModePicker, plural } from './pickers'
import type { Settings } from './settings'
import { sheetList } from './Sheet'

export const SITE_URL = 'https://chvdbhcx-del.github.io/durak/'

interface Props {
  online: Online
  settings: Settings
  onChange: (s: Settings) => void
  initialCode: string
  onBack: () => void
}

/** Five big letter boxes over one real input, so phone keyboards and paste just work. */
function CodeInput({ value, onChange, onDone }: { value: string; onChange: (v: string) => void; onDone: () => void }) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => ref.current?.focus(), [])
  return (
    <label className="code-input" htmlFor="room-code">
      <input
        id="room-code"
        ref={ref}
        value={value}
        inputMode="text"
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        aria-label="Код комнаты"
        onChange={(e) => onChange(normalizeCode(e.target.value))}
        onKeyDown={(e) => e.key === 'Enter' && value.length === CODE_LENGTH && onDone()}
      />
      {Array.from({ length: CODE_LENGTH }, (_, i) => (
        <motion.span key={i} className={`code-box ${i === value.length ? 'caret' : ''} ${value[i] ? 'filled' : ''}`} animate={value[i] ? { scale: [1.15, 1] } : { scale: 1 }} transition={{ duration: 0.18 }}>
          {value[i] ?? ''}
        </motion.span>
      ))}
    </label>
  )
}

function NameBadge({ name, onChange }: { name: string; onChange: (n: string) => void }) {
  const [editing, setEditing] = useState(false)
  return (
    <div className="name-badge">
      <motion.span key={name[0]} className="name-avatar" initial={{ scale: 0.6 }} animate={{ scale: 1 }}>
        {name.trim()[0]?.toUpperCase() ?? '?'}
      </motion.span>
      {editing ? (
        <input
          id="player-name"
          className="name-edit"
          value={name}
          maxLength={16}
          autoFocus
          aria-label="Ваше имя"
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => {
            if (!name.trim()) onChange('Игрок')
            setEditing(false)
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      ) : (
        <button type="button" className="name-show" onClick={() => setEditing(true)}>
          {name}
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path fill="currentColor" d="M4 17.3V20h2.7l8-8-2.7-2.7-8 8zm12.7-7.6a.9.9 0 0 0 0-1.3l-1.1-1.1a.9.9 0 0 0-1.3 0l-1 1 2.4 2.4 1-1z" />
          </svg>
        </button>
      )}
      <span className="name-hint">Так вас увидят друзья</span>
    </div>
  )
}

function CardSpinner() {
  return (
    <div className="card-spinner" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <motion.span key={i} className="spin-card" animate={{ rotate: [0, 360] }} transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut', delay: i * 0.12 }} />
      ))}
    </div>
  )
}

export function OnlineScreen({ online, settings, onChange, initialCode, onBack }: Props) {
  const [mode, setMode] = useState<'choose' | 'join'>(initialCode ? 'join' : 'choose')
  const [code, setCode] = useState(initialCode)
  const [copied, setCopied] = useState(false)
  const { phase, lobby, role, error } = online

  const back = () => {
    if (phase !== 'idle') online.leave()
    else if (mode === 'join') setMode('choose')
    else onBack()
  }

  const invite = async () => {
    if (!lobby) return
    const url = `${SITE_URL}#join-${lobby.code}`
    const text = `Сыграем в дурака? Код комнаты: ${lobby.code}`
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Дурак', text, url })
        return
      }
    } catch {
      /* share sheet closed or unavailable: fall back to copying */
    }
    try {
      await navigator.clipboard.writeText(`${text}\n${url}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      /* clipboard blocked: the code stays on screen to read out */
    }
  }

  const host = role === 'host'
  const players = lobby ? lobby.members.filter((m) => m.online).length + lobby.bots : 0
  const roomFull = lobby ? lobby.members.length + lobby.bots >= maxPlayers(lobby.deckSize) : false
  const hostName = lobby?.members.find((m) => m.host)?.name ?? 'хозяин'

  return (
    <motion.main className="screen" initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }} transition={{ type: 'spring', stiffness: 320, damping: 32 }}>
      <header className="screen-head">
        <BackButton onClick={back} />
        <h1>{phase === 'lobby' ? 'Комната' : 'Онлайн'}</h1>
      </header>

      <div className="screen-body">
        <AnimatePresence mode="wait">
          {phase === 'idle' && (
            <motion.div key={`idle-${mode}`} className="online-block" variants={sheetList} initial="hidden" animate="shown" exit={{ opacity: 0, y: -10 }}>
              <NameBadge name={settings.name} onChange={(name) => onChange({ ...settings, name })} />
              {mode === 'choose' ? (
                <div className="way-cards">
                  <motion.button
                    type="button"
                    className="way"
                    whileHover={{ y: -4 }}
                    whileTap={{ scale: 0.97 }}
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    onClick={() => online.create({ name: settings.name.trim() || 'Игрок', mode: settings.mode, deckSize: settings.deckSize })}
                  >
                    <span className="way-art plus" aria-hidden="true">
                      +
                    </span>
                    <span className="way-title">Создать комнату</span>
                    <span className="way-note">Получите код и позовите друзей</span>
                  </motion.button>
                  <motion.button type="button" className="way" whileHover={{ y: -4 }} whileTap={{ scale: 0.97 }} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.16 }} onClick={() => setMode('join')}>
                    <span className="way-art key" aria-hidden="true">
                      <svg viewBox="0 0 24 24" width="28" height="28">
                        <path fill="currentColor" d="M7 14a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm5.6-4A6 6 0 1 0 12.6 14H15v3h3v-3h2v-4h-7.4z" />
                      </svg>
                    </span>
                    <span className="way-title">Войти по коду</span>
                    <span className="way-note">Если друг уже создал комнату</span>
                  </motion.button>
                </div>
              ) : (
                <motion.div className="join-block" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
                  <p className="join-label">Код комнаты</p>
                  <CodeInput value={code} onChange={setCode} onDone={() => online.join(code, settings.name.trim() || 'Игрок')} />
                  <motion.button
                    type="button"
                    className="primary big"
                    disabled={code.length !== CODE_LENGTH}
                    whileTap={{ scale: 0.96 }}
                    onClick={() => online.join(code, settings.name.trim() || 'Игрок')}
                  >
                    Войти
                  </motion.button>
                </motion.div>
              )}
            </motion.div>
          )}

          {phase === 'connecting' && (
            <motion.div key="connecting" className="online-block center" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
              <CardSpinner />
              <p className="big-note">{role === 'host' ? 'Создаём комнату…' : 'Подключаемся…'}</p>
            </motion.div>
          )}

          {phase === 'error' && (
            <motion.div key="error" className="online-block center" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <motion.span className="error-mark" initial={{ rotate: -20, scale: 0.5 }} animate={{ rotate: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 400, damping: 14 }} aria-hidden="true">
                !
              </motion.span>
              <p className="big-note">{error}</p>
              <p className="muted">Если вы в мобильной сети, попробуйте через Wi-Fi.</p>
              <motion.button type="button" className="primary big narrow" whileTap={{ scale: 0.96 }} onClick={() => online.leave()}>
                Понятно
              </motion.button>
            </motion.div>
          )}

          {phase === 'lobby' && lobby && (
            <motion.div key="lobby" className="online-block" variants={sheetList} initial="hidden" animate="shown" exit={{ opacity: 0 }}>
              <motion.section className="room-code" initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }}>
                <span className="group-title">Код комнаты</span>
                <div className="code-display" aria-label={`Код ${lobby.code.split('').join(' ')}`}>
                  {lobby.code.split('').map((ch, i) => (
                    <motion.span key={i} className="code-box filled" initial={{ rotateX: 90, opacity: 0 }} animate={{ rotateX: 0, opacity: 1 }} transition={{ delay: 0.1 + i * 0.06, type: 'spring', stiffness: 300, damping: 20 }}>
                      {ch}
                    </motion.span>
                  ))}
                </div>
                {host && (
                  <motion.button type="button" className="ghost invite" whileTap={{ scale: 0.95 }} onClick={invite}>
                    <AnimatePresence mode="wait" initial={false}>
                      <motion.span key={copied ? 'ok' : 'share'} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>
                        {copied ? 'Ссылка скопирована' : 'Пригласить друзей'}
                      </motion.span>
                    </AnimatePresence>
                  </motion.button>
                )}
              </motion.section>

              <Group title="Игроки" value={`${players} ${plural(players, 'игрок', 'игрока', 'игроков')}`}>
                <div className="lobby-seats">
                  <AnimatePresence>
                    {lobby.members.map((m) => (
                      <motion.div key={m.token} layout className={`lobby-seat ${m.online ? '' : 'off'}`} initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: m.online ? 1 : 0.4 }} exit={{ scale: 0, opacity: 0 }} transition={{ type: 'spring', stiffness: 500, damping: 24 }}>
                        <span className="avatar-circle person">{m.name[0]?.toUpperCase()}</span>
                        <span className="avatar-name">{m.name}</span>
                        {m.host && <span className="seat-tag">хозяин</span>}
                        {host && !m.host && (
                          <button type="button" className="seat-kick" aria-label={`Убрать ${m.name}`} onClick={() => online.kick(m.token)}>
                            ×
                          </button>
                        )}
                      </motion.div>
                    ))}
                    {Array.from({ length: lobby.bots }, (_, i) => (
                      <motion.div key={`bot-${i}`} layout className="lobby-seat" initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0, opacity: 0 }} transition={{ type: 'spring', stiffness: 500, damping: 24 }}>
                        <span className="avatar-circle">{BOT_NAMES[i][0]}</span>
                        <span className="avatar-name">{BOT_NAMES[i]}</span>
                        <span className="seat-tag">бот</span>
                      </motion.div>
                    ))}
                    {host && !roomFull && (
                      <motion.button key="add-bot" layout type="button" className="lobby-seat add" whileTap={{ scale: 0.92 }} onClick={() => online.setLobby({ bots: lobby.bots + 1 })} initial={{ scale: 0 }} animate={{ scale: 1 }}>
                        <span className="avatar-circle dashed">+</span>
                        <span className="avatar-name">Бот</span>
                      </motion.button>
                    )}
                    {host && lobby.bots > 0 && (
                      <motion.button key="remove-bot" layout type="button" className="lobby-seat add" whileTap={{ scale: 0.92 }} onClick={() => online.setLobby({ bots: lobby.bots - 1 })} initial={{ scale: 0 }} animate={{ scale: 1 }}>
                        <span className="avatar-circle dashed">−</span>
                        <span className="avatar-name">Убрать</span>
                      </motion.button>
                    )}
                  </AnimatePresence>
                </div>
              </Group>

              {host ? (
                <>
                  <ModePicker value={lobby.mode} onChange={(m) => online.setLobby({ mode: m })} />
                  <DeckPicker value={lobby.deckSize} onChange={(d) => online.setLobby({ deckSize: d })} />
                  <motion.button type="button" className="primary big" disabled={players < 2} whileTap={{ scale: 0.96 }} whileHover={{ y: -2 }} onClick={online.start}>
                    {players < 2 ? 'Ждём хотя бы одного игрока' : 'Начать игру'}
                  </motion.button>
                </>
              ) : (
                <motion.div className="waiting" variants={sheetList}>
                  <span className="chip">
                    {lobby.mode === 'podkidnoy' ? 'Подкидной' : 'Переводной'} · {lobby.deckSize} карт
                  </span>
                  <p className="big-note">
                    Ждём, пока {hostName} начнёт
                    {[0, 1, 2].map((i) => (
                      <motion.span key={i} animate={{ opacity: [0.2, 1, 0.2] }} transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}>
                        .
                      </motion.span>
                    ))}
                  </p>
                </motion.div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.main>
  )
}
