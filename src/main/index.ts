import { app, BrowserWindow, shell, systemPreferences, session, protocol, net } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createTables, setSetting } from './db'
import { registerIpcHandlers } from './ipc'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true
    }
  }
])

const isDev = !app.isPackaged

app.setName('Prism')

function createWindow(): void {
  const isMac = process.platform === 'darwin'
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    frame: isMac,
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: isMac ? { x: 16, y: 18 } : undefined,
    vibrancy: isMac ? 'under-window' : undefined,
    visualEffectState: isMac ? 'active' : undefined,
    backgroundColor: '#00000000',
    title: 'Prism',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow.show())

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadURL('app://-/index.html')
  }
}

app.whenReady().then(async () => {
  protocol.handle('app', (request) => {
    const urlObj = new URL(request.url)
    let pathName = urlObj.pathname
    if (pathName === '/' || pathName === '') pathName = '/index.html'
    
    const filePath = join(__dirname, '../renderer', pathName)
    return net.fetch(pathToFileURL(filePath).href).then((response) => {
      const newHeaders = new Headers(response.headers)
      newHeaders.set('Cross-Origin-Opener-Policy', 'same-origin')
      newHeaders.set('Cross-Origin-Embedder-Policy', 'credentialless')
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders
      })
    })
  })

  createTables()
  setSetting('app.version', app.getVersion())
  registerIpcHandlers()

  // Ensure macOS microphone permissions are explicitly requested
  if (process.platform === 'darwin') {
    const status = systemPreferences.getMediaAccessStatus('microphone')
    if (status === 'not-determined') {
      try {
        await systemPreferences.askForMediaAccess('microphone')
      } catch (err) {
        console.warn('Microphone access request failed:', err)
      }
    }
  }

  // Auto-allow media requests from the internal renderer so the OS handles it
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media') {
      callback(true)
    } else {
      // Default allow for local electron windows
      callback(true)
    }
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
