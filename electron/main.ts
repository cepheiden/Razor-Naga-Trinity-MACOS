import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  powerMonitor,
  shell,
  systemPreferences,
  Tray,
} from 'electron'
import { join } from 'node:path'
import { applyHardwareProfile, applyRgbOnly, listNagaDevices, setRgbOff } from './nagaDriver'
import { registerProfileShortcuts, unregisterAllMacroShortcuts } from './macroEngine'
import {
  deleteProfile,
  duplicateProfile,
  readStore,
  setActiveProfile,
  updateSettings,
  upsertProfile,
  writeStore,
} from './profileStore'
import type { AppSettings, NagaProfile, ProfileStore, RgbSettings } from './types'

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL)

const TRAY_ICON_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAO0lEQVR4nGNgGOzgPxRTpJksQ9A1k2QILs1EGUJIM15DiNWM0xCKDaDYC8QaQhSgSDMuQ8gCFGmmDwAAhdVTrfcfBBYAAAAASUVORK5CYII='

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
let cachedRgbOffOnLock = true
let cachedLang: 'de' | 'en' = 'de'

const TRAY_STRINGS = {
  de: {
    openWindow: 'Fenster öffnen',
    reapplyProfile: 'Profil neu anwenden',
    launchAtLogin: 'Bei macOS-Login starten',
    rgbOffOnLock: 'RGB beim Sperren ausschalten',
    quit: 'Beenden',
  },
  en: {
    openWindow: 'Open window',
    reapplyProfile: 'Re-apply profile',
    launchAtLogin: 'Launch at macOS login',
    rgbOffOnLock: 'Turn RGB off when screen locks',
    quit: 'Quit',
  },
} as const

const tx = () => TRAY_STRINGS[cachedLang]

const detectInitialLang = (stored: 'de' | 'en' | undefined): 'de' | 'en' => {
  if (stored === 'de' || stored === 'en') return stored
  const sys = app.getLocale().toLowerCase()
  return sys.startsWith('de') ? 'de' : 'en'
}

const refreshSettingsCache = async () => {
  const store = await readStore()
  cachedRgbOffOnLock = store.settings?.rgbOffOnLock !== false
  cachedLang = detectInitialLang(store.settings?.language)
}

const createWindow = async () => {
  if (mainWindow) {
    mainWindow.show()
    return
  }

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1080,
    minHeight: 720,
    title: 'Naga Trinity Control',
    backgroundColor: '#0a0c0a',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.on('close', (event) => {
    if (isQuitting) return
    event.preventDefault()
    mainWindow?.hide()
    app.dock?.hide()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    await mainWindow.loadFile(join(__dirname, '../dist/index.html'))
  }
  mainWindow.show()
}

const showWindow = async () => {
  app.dock?.show()
  if (mainWindow) {
    mainWindow.show()
    mainWindow.focus()
  } else {
    await createWindow()
  }
}

const buildTrayMenu = () => {
  const s = tx()
  return Menu.buildFromTemplate([
    {
      label: s.openWindow,
      click: () => {
        void showWindow()
      },
    },
    {
      label: s.reapplyProfile,
      click: () => {
        void applyActiveProfile()
      },
    },
    { type: 'separator' },
    {
      label: s.launchAtLogin,
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => {
        app.setLoginItemSettings({
          openAtLogin: item.checked,
          openAsHidden: true,
        })
      },
    },
    {
      label: s.rgbOffOnLock,
      type: 'checkbox',
      checked: cachedRgbOffOnLock,
      click: (item) => {
        cachedRgbOffOnLock = item.checked
        void updateSettings({ rgbOffOnLock: item.checked }).then(() => {
          tray?.setContextMenu(buildTrayMenu())
        })
      },
    },
    { type: 'separator' },
    {
      label: s.quit,
      click: () => {
        isQuitting = true
        app.quit()
      },
    },
  ])
}

const ensureAccessibilityPermission = () => {
  // macOS: ohne diese Permission feuern weder globalShortcut-Callbacks noch osascript-Tippeingaben.
  if (process.platform !== 'darwin') return
  // Mit prompt=true zeigt macOS automatisch den Dialog mit Link zu den Systemeinstellungen, falls noch nicht erteilt.
  systemPreferences.isTrustedAccessibilityClient(true)
}

const createTray = () => {
  const icon = nativeImage.createFromDataURL(TRAY_ICON_DATA_URL)
  icon.setTemplateImage(true)
  tray = new Tray(icon)
  tray.setToolTip('Naga Trinity Control')
  tray.setContextMenu(buildTrayMenu())
  tray.on('click', () => {
    void showWindow()
  })
}

const applyActiveProfile = async () => {
  const store = await readStore()
  const active = store.profiles.find((p) => p.id === store.activeProfileId)
  if (!active) return
  const hwResult = await applyHardwareProfile(active)
  console.log('[naga] applyHardwareProfile:', hwResult.ok ? 'OK' : 'FAIL', '-', hwResult.message)
  const reg = registerProfileShortcuts(active)
  console.log('[naga] macroShortcuts:', reg)
}

const restoreActiveProfileRgb = async () => {
  const store = await readStore()
  const active = store.profiles.find((p) => p.id === store.activeProfileId)
  if (!active) return
  // Kurz warten, damit USB nach Wake bzw. Unlock wirklich verfügbar ist.
  await new Promise((resolve) => setTimeout(resolve, 600))
  void applyRgbOnly(active.rgb)
}

const shouldDimOnLock = async () => {
  const store = await readStore()
  return store.settings?.rgbOffOnLock !== false
}

const registerPowerHandlers = () => {
  powerMonitor.on('lock-screen', () => {
    void shouldDimOnLock().then((dim) => {
      if (dim) void setRgbOff()
    })
  })
  powerMonitor.on('unlock-screen', () => {
    void restoreActiveProfileRgb()
  })
  powerMonitor.on('suspend', () => {
    void shouldDimOnLock().then((dim) => {
      if (dim) void setRgbOff()
    })
  })
  powerMonitor.on('resume', () => {
    void restoreActiveProfileRgb()
  })
}

ipcMain.handle('device:scan', () => listNagaDevices())
ipcMain.handle('store:read', () => readStore())
ipcMain.handle('store:write', async (_event, store: ProfileStore) => writeStore(store))
ipcMain.handle('profile:upsert', async (_event, profile: NagaProfile) => upsertProfile(profile))
ipcMain.handle('profile:delete', async (_event, id: string) => deleteProfile(id))
ipcMain.handle('profile:duplicate', async (_event, id: string) => duplicateProfile(id))
ipcMain.handle('profile:set-active', async (_event, id: string) => setActiveProfile(id))
ipcMain.handle('profile:apply', async (_event, profile: NagaProfile) => {
  const result = await applyHardwareProfile(profile)
  if (result.ok) {
    await upsertProfile(profile)
    await setActiveProfile(profile.id)
    const reg = registerProfileShortcuts(profile)
    console.log('[naga] macroShortcuts after apply:', reg)
  }
  return result
})
ipcMain.handle('rgb:preview', async (_event, rgb: RgbSettings) => applyRgbOnly(rgb))

ipcMain.handle('app:get-login-item', () => app.getLoginItemSettings().openAtLogin)
ipcMain.handle('app:set-login-item', (_event, enabled: boolean) => {
  app.setLoginItemSettings({ openAtLogin: Boolean(enabled), openAsHidden: true })
  tray?.setContextMenu(buildTrayMenu())
  return app.getLoginItemSettings().openAtLogin
})
ipcMain.handle('app:hide-window', () => {
  mainWindow?.hide()
  app.dock?.hide()
})
ipcMain.handle('app:get-settings', async () => {
  const store = await readStore()
  return store.settings ?? { rgbOffOnLock: true }
})
ipcMain.handle('app:update-settings', async (_event, partial: Partial<AppSettings>) => {
  const next = await updateSettings(partial)
  cachedRgbOffOnLock = next.settings?.rgbOffOnLock !== false
  cachedLang = detectInitialLang(next.settings?.language)
  tray?.setContextMenu(buildTrayMenu())
  return next.settings ?? { rgbOffOnLock: true }
})

app.whenReady().then(async () => {
  ensureAccessibilityPermission()
  await refreshSettingsCache()
  registerPowerHandlers()
  createTray()

  // Beim Auto-Login mit openAsHidden startet die App ohne sichtbares Fenster – nur Tray.
  const launchedHidden = app.getLoginItemSettings().wasOpenedAsHidden
  if (!launchedHidden) {
    await createWindow()
  } else {
    app.dock?.hide()
  }

  // RGB nach Start automatisch wiederherstellen (daemon-Pattern).
  void applyActiveProfile()
})

app.on('window-all-closed', () => {
  // macOS: App bleibt im Tray laufen, kein quit.
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  void showWindow()
})

app.on('before-quit', () => {
  isQuitting = true
  unregisterAllMacroShortcuts()
})
