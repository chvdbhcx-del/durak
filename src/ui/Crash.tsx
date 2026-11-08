import { Component, type ReactNode } from 'react'

const SAVED_KEYS = ['durak.game', 'durak.online']

/**
 * Last line of defence: an error anywhere in the app shows a way back instead of a blank screen.
 * Starting over drops the saved table (the likely culprit) but keeps coins, stats and settings.
 */
export class Crash extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown) {
    console.error('durak crashed', error)
  }

  private restart = () => {
    try {
      for (const k of SAVED_KEYS) localStorage.removeItem(k)
    } catch {
      /* storage blocked */
    }
    location.reload()
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <main className="crash" role="alert">
        <div className="crash-mark" aria-hidden="true">
          🂠
        </div>
        <h1>Что-то пошло не так</h1>
        <button type="button" className="primary" onClick={this.restart} autoFocus>
          Начать заново
        </button>
      </main>
    )
  }
}
