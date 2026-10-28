import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.chvdbhcx.durak',
  appName: 'Дурак',
  webDir: 'dist',
  backgroundColor: '#0d1112',
  ios: { contentInset: 'never' },
  plugins: {
    // Updates come from this repo's GitHub releases (see src/ui/updates.ts), not Capgo's cloud,
    // and nothing is reported back to Capgo.
    CapacitorUpdater: {
      autoUpdate: false,
      statsUrl: '',
      appReadyTimeout: 10000,
    },
  },
}

export default config
