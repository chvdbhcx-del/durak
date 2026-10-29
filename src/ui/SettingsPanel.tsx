import { motion } from 'framer-motion'
import { maxPlayers } from '../engine/game'
import { CheatPicker, DeckPicker, HapticsPicker, ModePicker, OpponentsPicker, SoundPicker, SpeedPicker, ThemePicker } from './pickers'
import type { Settings } from './settings'
import { Sheet } from './Sheet'

interface Props {
  settings: Settings
  onChange: (s: Settings) => void
  onStart: (s: Settings) => void
  onClose: () => void
  inGame: boolean
}

export function withValidOpponents(s: Settings): Settings {
  return { ...s, opponents: Math.min(s.opponents, maxPlayers(s.deckSize) - 1) }
}

export function SettingsPanel({ settings, onChange, onStart, onClose, inGame }: Props) {
  const set = (patch: Partial<Settings>) => onChange(withValidOpponents({ ...settings, ...patch }))

  return (
    <Sheet
      title="Настройки"
      onClose={onClose}
      footer={
        <>
          <p className="foot-note">{inGame ? 'Тема, звук и скорость меняются сразу. Режим, колода и соперники вступят в силу в новой партии.' : 'Всё сохраняется само.'}</p>
          <motion.button type="button" className="primary big" whileTap={{ scale: 0.96 }} onClick={() => onStart(settings)}>
            {inGame ? 'Новая партия с ботами' : 'Играть с ботами'}
          </motion.button>
        </>
      }
    >
      <ModePicker value={settings.mode} onChange={(mode) => set({ mode })} />
      <OpponentsPicker value={settings.opponents} max={maxPlayers(settings.deckSize) - 1} onChange={(opponents) => set({ opponents })} />
      <DeckPicker value={settings.deckSize} onChange={(deckSize) => set({ deckSize })} />
      <CheatPicker value={settings.cheat} onChange={(cheat) => set({ cheat })} />
      <SpeedPicker value={settings.speed} onChange={(speed) => set({ speed })} />
      <SoundPicker value={settings.sound} onChange={(sound) => set({ sound })} />
      <HapticsPicker value={settings.haptics} onChange={(haptics) => set({ haptics })} />
      <ThemePicker value={settings.theme} onChange={(theme) => set({ theme })} />
    </Sheet>
  )
}
