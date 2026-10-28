import type { Suit } from '../engine/cards'

// Hand-drawn suit glyphs on a 24×24 grid, so suits look the same on every platform
// (the Unicode symbols turn into emoji on some phones).
const PATHS: Record<Suit, string> = {
  H: 'M12 21.2s-7.7-4.7-9.7-9.5C.8 8 2.9 3.8 6.9 3.8c2.2 0 3.7 1.2 5.1 3 1.4-1.8 2.9-3 5.1-3 4 0 6.1 4.2 4.6 7.9-2 4.8-9.7 9.5-9.7 9.5z',
  D: 'M12 1.8l7.6 10.2L12 22.2 4.4 12z',
  S: 'M12 2s-8.4 6.4-9.6 10.6c-.9 3.2 1.3 5.6 4.1 5.6 1.7 0 3-.7 4-1.8l-1.1 5.8h5.2l-1.1-5.8c1 1.1 2.3 1.8 4 1.8 2.8 0 5-2.4 4.1-5.6C20.4 8.4 12 2 12 2z',
  C: 'M12 2.2a4.4 4.4 0 0 0-3.8 6.6 4.4 4.4 0 1 0 2.4 7.6l-1.1 5.4h5l-1.1-5.4a4.4 4.4 0 1 0 2.4-7.6A4.4 4.4 0 0 0 12 2.2z',
}

export function SuitIcon({ suit, size = '1em', className }: { suit: Suit; size?: string | number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} aria-hidden="true">
      <path d={PATHS[suit]} fill="currentColor" />
    </svg>
  )
}
