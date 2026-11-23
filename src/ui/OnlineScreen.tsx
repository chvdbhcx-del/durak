import { presenceText } from './FriendsPanel'
import { Coin, StakePicker } from './Money'
import { affordableStake, formatCoins, type Wallet } from './wallet'
import { AnimatePresence, m } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import { maxPlayers } from '../engine/game'
import { CODE_LENGTH, normalizeCode, peekRoom, type RoomPreview } from '../net/room'
import type { Friends } from '../net/useFriends'
import type { Online } from '../net/useOnline'
import { BackButton } from './PlayScreen'
import { BOT_NAMES, CheatPicker, DeckPicker, DifficultyPicker, Group, ModePicker, plural } from './pickers'
import { RoomLink } from './RoomStatus'
import { AVATARS, cleanName, type Settings } from './settings'
import { Sheet, sheetList } from './Sheet'
import { appLink, type Invite, inviteFromText, inviteUrl, webPlatform } from './deeplink'


interface Props {
  online: Online
  settings: Settings
  wallet: Wallet
  onChange: (s: Settings) => void
  /** the room server in use now: the invite's own, or the one from the settings */
  server: string
  onInviteServer: (server: string) => void
  initialCode: string
  /** opened from an invite in a plain browser tab: offer the installed app first */
  offerApp?: boolean
  friends: Friends
  onInviteFriend: (fid: string) => void
  /** coins given back when a room game was cut off through no fault of this player */
  refund?: number | null
  onBack: () => void
}

const STAGE_TEXT = { loading: 'Загружаем онлайн-игру…', broker: 'Ищем комнату', host: 'Соединяемся с хостом…', hello: 'Входим…' } as const

const modeName = (mode: string) => (mode === 'podkidnoy' ? 'Подкидной' : 'Переводной')

/** «Хост зовёт: Подкидной · 36 · ставка 100», asked from the room itself before joining. */
function InvitePreview({ code }: { code: string }) {
  const [info, setInfo] = useState<RoomPreview | null>(null)
  useEffect(() => {
    let live = true
    peekRoom(code).then((p) => live && setInfo(p))
    return () => {
      live = false
    }
  }, [code])
  return (
    <AnimatePresence>
      {info && (
        <m.p className="invite-preview" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}>
          <b>{info.host} зовёт:</b> {modeName(info.mode)} · {info.deckSize} карт{info.stake > 0 ? ` · ставка ${formatCoins(info.stake)}` : ''} · {info.players} из {info.max}
          {info.playing && <span className="muted"> · партия уже идёт, сыграете в следующей</span>}
        </m.p>
      )}
    </AnimatePresence>
  )
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
        <m.span key={i} className={`code-box ${i === value.length ? 'caret' : ''} ${value[i] ? 'filled' : ''}`} animate={value[i] ? { scale: [1.15, 1] } : { scale: 1 }} transition={{ duration: 0.18 }}>
          {value[i] ?? ''}
        </m.span>
      ))}
    </label>
  )
}

/**
 * Shown when an invite opens in a plain browser tab. The browser keeps its own profile (name, coins,
 * friends) apart from the app and from a site on the home screen, so the invite is offered there first.
 */
function AppHandoff({ code, server, onBrowser }: { code: string; server: string; onBrowser: () => void }) {
  const platform = webPlatform()
  const link = appLink({ code, server }, platform)
  const [copied, setCopied] = useState(false)
  // On iPhone the whole link is copied: the home-screen game pastes it in one tap.
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl(code, server))
      setCopied(true)
    } catch {
      /* clipboard blocked: the code is on screen */
    }
  }
  if (link)
    return (
      <m.section className="app-handoff" initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 320, damping: 26 }}>
        <span className="handoff-title">Вас позвали в комнату {code}</span>
        <m.a className="primary big handoff-open" href={link} whileTap={{ scale: 0.96 }}>
          Открыть в приложении
        </m.a>
        <button type="button" className="link" onClick={onBrowser}>
          Играть в браузере
        </button>
      </m.section>
    )
  // No app to open: joining here is the main action, and a home-screen game on iPhone gets one quiet line.
  if (platform !== 'ios') return null
  return (
    <p className="handoff-note handoff-line">
      {copied ? (
        'Скопировано. Откройте Дурак с экрана «Домой» и нажмите «Вставить приглашение».'
      ) : (
        <>
          Есть Дурак на экране «Домой»?{' '}
          <button type="button" className="link" onClick={copy}>
            Скопировать приглашение
          </button>
        </>
      )}
    </p>
  )
}

/** Fills the code from the clipboard: a copied invite message, link or bare code. */
function PasteButton({ onCode }: { onCode: (inv: Invite) => void }) {
  const [miss, setMiss] = useState(false)
  if (!navigator.clipboard?.readText) return null
  const paste = async () => {
    try {
      const inv = inviteFromText(await navigator.clipboard.readText())
      if (inv) onCode(inv)
      else {
        setMiss(true)
        setTimeout(() => setMiss(false), 1800)
      }
    } catch {
      /* the person declined the paste prompt */
    }
  }
  return (
    <m.button type="button" className="link paste-code" whileTap={{ scale: 0.95 }} onClick={paste}>
      {miss ? 'В буфере нет кода' : 'Вставить'}
    </m.button>
  )
}

/** The name friends see, with the profile's avatar; the same rule as the profile: an emptied field keeps the old name. */
function NameBadge({ name, avatar, onChange }: { name: string; avatar: string; onChange: (n: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  return (
    <div className="name-badge">
      <m.span key={avatar} className="name-avatar" initial={{ scale: 0.6 }} animate={{ scale: 1 }}>
        {avatar}
      </m.span>
      {editing ? (
        <input
          id="player-name"
          className="name-edit"
          value={draft}
          maxLength={16}
          autoFocus
          aria-label="Ваше имя"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            const next = cleanName(draft, name)
            if (next !== name) onChange(next)
            setEditing(false)
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      ) : (
        <button
          type="button"
          className="name-show"
          onClick={() => {
            setDraft(name)
            setEditing(true)
          }}
        >
          {name}
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path fill="currentColor" d="M4 17.3V20h2.7l8-8-2.7-2.7-8 8zm12.7-7.6a.9.9 0 0 0 0-1.3l-1.1-1.1a.9.9 0 0 0-1.3 0l-1 1 2.4 2.4 1-1z" />
          </svg>
        </button>
      )}
    </div>
  )
}

function CardSpinner() {
  return (
    <div className="card-spinner" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <m.span key={i} className="spin-card" animate={{ rotate: [0, 360] }} transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut', delay: i * 0.12 }} />
      ))}
    </div>
  )
}

export function OnlineScreen({ online, settings, wallet, onChange, server, onInviteServer, initialCode, offerApp = false, friends, onInviteFriend, refund, onBack }: Props) {
  const [mode, setMode] = useState<'choose' | 'join'>(initialCode ? 'join' : 'choose')
  const [code, setCode] = useState(initialCode)
  const [copied, setCopied] = useState(false)
  const [codeCopied, setCodeCopied] = useState(false)
  const [setup, setSetup] = useState(false)
  /** Android: the app was offered first; the code field shows once the player picks the browser */
  const [inBrowser, setInBrowser] = useState(false)
  const { phase, lobby, role, error } = online
  const handoff = offerApp && code === initialCode && !!appLink({ code: initialCode, server }) && !inBrowser
  // A short note in the room: a bot making way, or the stake the host just changed.
  const [roomNote, setRoomNote] = useState<{ key: number; text: string } | null>(null)
  const noteKey = lobby?.note?.key
  useEffect(() => {
    if (lobby?.note) setRoomNote(lobby.note)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteKey])
  const stake = lobby?.stake ?? 0
  const lastStake = useRef<number | null>(null)
  useEffect(() => {
    if (phase !== 'lobby') {
      lastStake.current = null
      return
    }
    if (role === 'guest' && lastStake.current !== null && lastStake.current !== stake) setRoomNote({ key: Date.now(), text: stake ? `Ставка теперь ${formatCoins(stake)}` : 'Теперь без ставки' })
    lastStake.current = stake
  }, [stake, phase, role])
  useEffect(() => {
    if (!roomNote) return
    const t = setTimeout(() => setRoomNote((n) => (n === roomNote ? null : n)), 3500)
    return () => clearTimeout(t)
  }, [roomNote])
  const { refresh } = friends
  const watching = phase !== 'idle' && role === 'host'
  useEffect(() => {
    if (!watching) return
    refresh()
    const t = setInterval(refresh, 12000)
    return () => clearInterval(t)
  }, [watching, refresh])

  const back = () => {
    if (phase !== 'idle') online.leave()
    else if (mode === 'join') setMode('choose')
    else onBack()
  }

  const copyCode = async () => {
    if (!lobby) return
    try {
      await navigator.clipboard.writeText(lobby.code)
      setCodeCopied(true)
      setTimeout(() => setCodeCopied(false), 1600)
    } catch {
      /* clipboard blocked: the code stays on screen */
    }
  }

  const invite = async (roomCode = lobby?.code) => {
    if (!roomCode) return
    const url = inviteUrl(roomCode, server)
    const text = `Сыграем в дурака? Код комнаты: ${roomCode}`
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
  const hostName = lobby?.members.find((m) => m.host)?.name ?? 'хост'
  const joinNow = () => online.join(code, settings.name.trim() || 'Игрок')
  const createOwn = () => {
    online.leave()
    online.create({ name: settings.name.trim() || 'Игрок', mode: settings.mode, deckSize: settings.deckSize, cheat: settings.cheat })
  }
  const otherCode = () => {
    online.leave()
    setCode('')
    setMode('join')
  }
  const toMenu = () => onBack()
  const kind = error?.kind ?? 'other'
  const netHint = kind === 'network' || kind === 'server' || kind === 'p2p'
  const errorTitle =
    kind === 'not-found'
      ? `Комнаты ${online.code} нет`
      : kind === 'closed'
        ? 'Хост закрыл комнату'
        : kind === 'kicked'
          ? 'Хост убрал вас из комнаты'
          : kind === 'same-device'
            ? 'Это ваша же комната'
            : kind === 'full'
              ? 'В комнате нет мест'
              : kind === 'lost'
                ? 'Связь потеряна'
                : (error?.message ?? 'Что-то пошло не так')
  const errorNote =
    kind === 'not-found'
      ? 'Возможно, хост её уже закрыл. Проверьте код или создайте свою.'
      : kind === 'same-device'
        ? 'Она открыта на этом же устройстве. Отправьте ссылку другу.'
        : kind === 'full'
          ? 'За столом уже все места заняты.'
          : kind === 'closed' || kind === 'kicked'
            ? ''
            : errorTitle === error?.message
              ? ''
              : (error?.message ?? '')
  const summary = lobby ? `${modeName(lobby.mode)} · ${lobby.deckSize} · ${lobby.cheat ? 'шулер' : 'честно'} · ${stake ? `ставка ${formatCoins(stake)}` : 'без ставки'}` : ''

  return (
    <m.main className="screen" initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }} transition={{ type: 'spring', stiffness: 320, damping: 32 }}>
      <header className="screen-head">
        <BackButton onClick={back} />
        <h1>{phase === 'lobby' ? 'Комната' : 'Онлайн'}</h1>
      </header>

      <div className="screen-body">
        {phase !== 'error' && <RoomLink inline link={{ guest: role === 'guest', reconnecting: online.reconnecting, lostAt: online.lostAt, hostAway: online.hostAway, hostName, onLeave: () => online.leave() }} />}
        <AnimatePresence>
          {roomNote && phase === 'lobby' && (
            <m.p key={roomNote.key} className="room-note" role="status" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>
              {roomNote.text}
            </m.p>
          )}
        </AnimatePresence>
        <AnimatePresence mode="wait">
          {phase === 'idle' && (
            <m.div key={`idle-${mode}`} className="online-block" variants={sheetList} initial="hidden" animate="shown" exit={{ opacity: 0, y: -10 }}>
              <NameBadge name={settings.name} avatar={AVATARS[settings.avatar] ?? AVATARS[0]} onChange={(name) => onChange({ ...settings, name })} />
              {mode === 'choose' ? (
                <div className="way-cards">
                  <m.button
                    type="button"
                    className="way"
                    whileHover={{ y: -4 }}
                    whileTap={{ scale: 0.97 }}
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    onClick={() => online.create({ name: settings.name.trim() || 'Игрок', mode: settings.mode, deckSize: settings.deckSize, cheat: settings.cheat })}
                  >
                    <span className="way-art plus" aria-hidden="true">
                      +
                    </span>
                    <span className="way-title">Создать комнату</span>
                    <span className="way-note">Позовите друзей по ссылке</span>
                  </m.button>
                  <m.button type="button" className="way" whileHover={{ y: -4 }} whileTap={{ scale: 0.97 }} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.16 }} onClick={() => setMode('join')}>
                    <span className="way-art key" aria-hidden="true">
                      <svg viewBox="0 0 24 24" width="28" height="28">
                        <path fill="currentColor" d="M7 14a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm5.6-4A6 6 0 1 0 12.6 14H15v3h3v-3h2v-4h-7.4z" />
                      </svg>
                    </span>
                    <span className="way-title">Войти по коду</span>
                    <span className="way-note">Код из приглашения</span>
                  </m.button>
                </div>
              ) : (
                <m.div className="join-block" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
                  {offerApp && code === initialCode && !inBrowser && <AppHandoff code={initialCode} server={server} onBrowser={() => setInBrowser(true)} />}
                  {initialCode && code === initialCode && <InvitePreview code={initialCode} />}
                  {!handoff && (
                  <>
                  <div className="join-head">
                    <p className="join-label">Код комнаты</p>
                    {!(offerApp && code === initialCode) && (
                      <PasteButton
                        onCode={(inv) => {
                          setCode(inv.code)
                          onInviteServer(inv.server)
                        }}
                      />
                    )}
                  </div>
                  <CodeInput value={code} onChange={setCode} onDone={joinNow} />
                  <m.button type="button" className="primary big" disabled={code.length !== CODE_LENGTH} whileTap={{ scale: 0.96 }} onClick={joinNow}>
                    Войти
                  </m.button>
                  </>
                  )}
                </m.div>
              )}
            </m.div>
          )}

          {phase === 'connecting' && (
            <m.div key="connecting" className="online-block center" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
              <CardSpinner />
              <p className="big-note" role="status">
                {role === 'host' ? 'Создаём комнату…' : online.stage === 'broker' ? `${STAGE_TEXT.broker} ${online.code}…` : online.stage ? STAGE_TEXT[online.stage] : 'Подключаемся…'}
              </p>
              <AnimatePresence>
                {online.slow && (
                  <m.p className="muted" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                    Дольше обычного…
                  </m.p>
                )}
              </AnimatePresence>
              <m.button type="button" className="ghost narrow" whileTap={{ scale: 0.96 }} onClick={() => online.leave()}>
                Отмена
              </m.button>
            </m.div>
          )}

          {phase === 'error' && (
            <m.div key="error" className="online-block center" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <m.span className="error-mark" initial={{ rotate: -20, scale: 0.5 }} animate={{ rotate: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 400, damping: 14 }} aria-hidden="true">
                !
              </m.span>
              <p className="big-note">{errorTitle}</p>
              {errorNote && <p className="muted">{errorNote}</p>}
              {refund ? (
                <p className="refund-note">
                  <Coin size={14} /> Партия прервана, ставка {formatCoins(refund)} возвращена
                </p>
              ) : null}
              <div className="error-actions">
                {kind === 'not-found' || kind === 'full' ? (
                  <>
                    <m.button type="button" className="primary big" whileTap={{ scale: 0.96 }} autoFocus onClick={otherCode}>
                      Ввести другой код
                    </m.button>
                    <m.button type="button" className="ghost big" whileTap={{ scale: 0.96 }} onClick={kind === 'full' ? toMenu : createOwn}>
                      {kind === 'full' ? 'В меню' : 'Создать свою'}
                    </m.button>
                  </>
                ) : kind === 'closed' ? (
                  <>
                    <m.button type="button" className="primary big" whileTap={{ scale: 0.96 }} autoFocus onClick={createOwn}>
                      Создать свою
                    </m.button>
                    <m.button type="button" className="ghost big" whileTap={{ scale: 0.96 }} onClick={toMenu}>
                      В меню
                    </m.button>
                  </>
                ) : kind === 'same-device' ? (
                  <>
                    <m.button type="button" className="primary big" whileTap={{ scale: 0.96 }} autoFocus onClick={() => invite(online.code)}>
                      {copied ? 'Ссылка скопирована' : 'Поделиться ссылкой'}
                    </m.button>
                    <m.button type="button" className="ghost big" whileTap={{ scale: 0.96 }} onClick={toMenu}>
                      В меню
                    </m.button>
                  </>
                ) : kind === 'kicked' || kind === 'browser' ? (
                  <m.button type="button" className="primary big" whileTap={{ scale: 0.96 }} autoFocus onClick={toMenu}>
                    В меню
                  </m.button>
                ) : (
                  <>
                    <m.button type="button" className="primary big" whileTap={{ scale: 0.96 }} autoFocus onClick={() => online.retry()}>
                      Повторить
                    </m.button>
                    <m.button type="button" className="ghost big" whileTap={{ scale: 0.96 }} onClick={toMenu}>
                      В меню
                    </m.button>
                  </>
                )}
              </div>
              {netHint && <p className="muted small">В мобильной сети? Попробуйте через Wi-Fi.</p>}
            </m.div>
          )}

          {phase === 'lobby' && lobby && (
            <m.div key="lobby" className="online-block" variants={sheetList} initial="hidden" animate="shown" exit={{ opacity: 0 }}>
              <m.section className="room-code" initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }}>
                <span className="group-title" aria-live="polite">{codeCopied ? 'Код скопирован' : 'Код комнаты'}</span>
                <button type="button" className="code-display" aria-label={`Код ${lobby.code.split('').join(' ')}. Скопировать`} onClick={copyCode}>
                  {lobby.code.split('').map((ch, i) => (
                    <m.span key={i} className="code-box filled" initial={{ rotateX: 90, opacity: 0 }} animate={{ rotateX: 0, opacity: 1 }} transition={{ delay: 0.1 + i * 0.06, type: 'spring', stiffness: 300, damping: 20 }}>
                      {ch}
                    </m.span>
                  ))}
                </button>
                {host && (
                  <m.button type="button" className="ghost invite" whileTap={{ scale: 0.95 }} onClick={() => invite()}>
                    <AnimatePresence mode="wait" initial={false}>
                      <m.span key={copied ? 'ok' : 'share'} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>
                        {copied ? 'Ссылка скопирована' : 'Пригласить друзей'}
                      </m.span>
                    </AnimatePresence>
                  </m.button>
                )}
              </m.section>

              <Group title="Игроки" value={`${players} ${plural(players, 'игрок', 'игрока', 'игроков')}`}>
                <div className="lobby-seats">
                  <AnimatePresence>
                    {lobby.members.map((mem) => (
                      <m.div key={mem.id} layout className={`lobby-seat ${mem.online ? '' : 'off'}`} initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: mem.online ? 1 : 0.4 }} exit={{ scale: 0, opacity: 0 }} transition={{ type: 'spring', stiffness: 500, damping: 24 }}>
                        <span className="avatar-circle person">{mem.name[0]?.toUpperCase()}</span>
                        <span className="avatar-name">{mem.name}</span>
                        {mem.fid && mem.fid === friends.fid ? <span className="seat-tag me">вы</span> : mem.host ? <span className="seat-tag">хост</span> : null}
                        {mem.fid && mem.fid !== friends.fid && (
                          <button type="button" className={`seat-add ${friends.isFriend(mem.fid) ? 'done' : ''}`} aria-label={friends.isFriend(mem.fid) ? `${mem.name} уже в друзьях` : `Добавить ${mem.name} в друзья`} disabled={friends.isFriend(mem.fid)} onClick={() => friends.add(mem.fid!, mem.name)}>
                            {friends.isFriend(mem.fid) ? '✓' : '+'}
                          </button>
                        )}
                        {host && !mem.host && (
                          <button type="button" className="seat-kick" aria-label={`Убрать ${mem.name}`} onClick={() => online.kick(mem.id)}>
                            ×
                          </button>
                        )}
                      </m.div>
                    ))}
                    {Array.from({ length: lobby.bots }, (_, i) => (
                      <m.div key={`bot-${i}`} layout className="lobby-seat" initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0, opacity: 0 }} transition={{ type: 'spring', stiffness: 500, damping: 24 }}>
                        <span className="avatar-circle">{BOT_NAMES[i][0]}</span>
                        <span className="avatar-name">{BOT_NAMES[i]}</span>
                        <span className="seat-tag">бот</span>
                      </m.div>
                    ))}
                    {host && !roomFull && (
                      <m.button key="add-bot" layout type="button" className="lobby-seat add" whileTap={{ scale: 0.92 }} onClick={() => online.setLobby({ bots: lobby.bots + 1 })} initial={{ scale: 0 }} animate={{ scale: 1 }}>
                        <span className="avatar-circle dashed">+</span>
                        <span className="avatar-name">Бот</span>
                      </m.button>
                    )}
                    {host && lobby.bots > 0 && (
                      <m.button key="remove-bot" layout type="button" className="lobby-seat add" whileTap={{ scale: 0.92 }} onClick={() => online.setLobby({ bots: lobby.bots - 1 })} initial={{ scale: 0 }} animate={{ scale: 1 }}>
                        <span className="avatar-circle dashed">−</span>
                        <span className="avatar-name">Убрать</span>
                      </m.button>
                    )}
                  </AnimatePresence>
                </div>
              </Group>

              {host && friends.list.length > 0 && (
                <Group title="Позвать друга">
                  <div className="invite-list">
                    {friends.list
                      .filter((f) => !lobby.members.some((m) => m.fid === f.id))
                      .map((f) => (
                        <div key={f.id} className="invite-item">
                          <span className="invite-who">
                            <i className={`friend-dot ${friends.here[f.id] ? 'on' : ''}`} aria-hidden="true" />
                            <span>
                              <b>{f.name}</b>
                              <small>{presenceText(friends, f.id)}</small>
                            </span>
                          </span>
                          <m.button type="button" className="primary small" whileTap={{ scale: 0.94 }} onClick={() => onInviteFriend(f.id)}>
                            Позвать
                          </m.button>
                        </div>
                      ))}
                  </div>
                </Group>
              )}

              {host ? (
                <>
                  <m.button type="button" className="setup-summary" whileTap={{ scale: 0.98 }} onClick={() => setSetup(true)} aria-label={`Настройки партии: ${summary}`}>
                    <span>{summary}</span>
                    <span aria-hidden="true">›</span>
                  </m.button>
                  <AnimatePresence>
                    {setup && (
                      <Sheet key="room-setup" title="Настройки партии" onClose={() => setSetup(false)}>
                        <ModePicker value={lobby.mode} onChange={(m) => online.setLobby({ mode: m })} />
                        <DeckPicker value={lobby.deckSize} onChange={(d) => online.setLobby({ deckSize: d })} />
                        <CheatPicker value={!!lobby.cheat} onChange={(c) => online.setLobby({ cheat: c })} />
                        <StakePicker title="Ставка в комнате" value={stake} onChange={(next) => online.setLobby({ stake: next })} wallet={wallet} players={Math.max(2, players)} mult={1} />
                        {lobby.bots > 0 && <DifficultyPicker value={settings.difficulty} onChange={(difficulty) => onChange({ ...settings, difficulty })} />}
                      </Sheet>
                    )}
                  </AnimatePresence>
                  <m.button type="button" className="primary big" disabled={players < 2} whileTap={{ scale: 0.96 }} whileHover={{ y: -2 }} onClick={() => online.start(settings.difficulty)}>
                    {players < 2 ? 'Ждём хотя бы одного игрока' : 'Начать игру'}
                  </m.button>
                </>
              ) : (
                <m.div className="waiting" variants={sheetList}>
                  <span className="chip">
                    {modeName(lobby.mode)} · {lobby.deckSize} карт
                  </span>
                  {(lobby.stake ?? 0) > 0 && (
                    <span className="chip stake-chip">
                      <Coin size={13} />
                      Ставка {formatCoins(lobby.stake!)} · у вас {formatCoins(wallet.balance)}
                    </span>
                  )}
                  {(lobby.stake ?? 0) > 0 && affordableStake(wallet, lobby.stake!, Math.max(2, players)) < lobby.stake! && (
                    <p className="stake-warn">Монет не хватает на всю ставку: сыграете на {formatCoins(affordableStake(wallet, lobby.stake!, Math.max(2, players)))}.</p>
                  )}
                  <p className="big-note">
                    {lobby.playing ? 'Партия идёт, вы сыграете в следующей' : `Ждём, пока ${hostName} начнёт`}
                    {[0, 1, 2].map((i) => (
                      <m.span key={i} animate={{ opacity: [0.2, 1, 0.2] }} transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}>
                        .
                      </m.span>
                    ))}
                  </p>
                </m.div>
              )}
            </m.div>
          )}
        </AnimatePresence>
      </div>
    </m.main>
  )
}
