import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MotionConfig } from 'framer-motion'
// Fonts ship with the app so the native builds look right offline.
import '@fontsource/onest/cyrillic-400.css'
import '@fontsource/onest/latin-400.css'
import '@fontsource/onest/cyrillic-500.css'
import '@fontsource/onest/latin-500.css'
import '@fontsource/onest/cyrillic-600.css'
import '@fontsource/onest/latin-600.css'
import '@fontsource/onest/cyrillic-700.css'
import '@fontsource/onest/latin-700.css'
import '@fontsource/unbounded/cyrillic-600.css'
import '@fontsource/unbounded/latin-600.css'
import '@fontsource/unbounded/cyrillic-800.css'
import '@fontsource/unbounded/latin-800.css'
import { App } from './ui/App'
import { isNative } from './ui/native'
import { setupPlatform } from './ui/platform'
import './styles.css'

setupPlatform()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <App />
    </MotionConfig>
  </StrictMode>,
)

// Offline support for the installable web version; the native apps bundle their files already.
if (!isNative && 'serviceWorker' in navigator && location.protocol === 'https:') {
  try {
    navigator.serviceWorker.register('./sw.js').catch(() => {})
  } catch {
    /* sandboxed frames refuse service workers */
  }
}
