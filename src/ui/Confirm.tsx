import { m } from 'framer-motion'
import { Sheet, sheetItem } from './Sheet'

export interface ConfirmAsk {
  title: string
  text: string
  yes: string
  no: string
  run: () => void
}

/** A sheet that asks once before a step that affects other people or money. */
export function ConfirmSheet({ ask, onClose }: { ask: ConfirmAsk; onClose: () => void }) {
  return (
    <Sheet title={ask.title} onClose={onClose}>
      <m.p className="confirm-text" variants={sheetItem}>
        {ask.text}
      </m.p>
      <m.div className="game-menu-row" variants={sheetItem}>
        <m.button type="button" className="ghost big" whileTap={{ scale: 0.96 }} autoFocus onClick={onClose}>
          {ask.no}
        </m.button>
        <m.button
          type="button"
          className="danger big"
          whileTap={{ scale: 0.96 }}
          onClick={() => {
            onClose()
            ask.run()
          }}
        >
          {ask.yes}
        </m.button>
      </m.div>
    </Sheet>
  )
}
