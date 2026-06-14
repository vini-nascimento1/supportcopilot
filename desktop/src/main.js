// Fanvue Support Copilot — desktop shell (Phase 0 spike)
//
// Thin shell: one BrowserWindow loading the deployed Next.js app, plus one
// WebContentsView per tool card on the canvas. WebContentsViews are real
// top-level browsing contexts: X-Frame-Options / CSP frame-ancestors do not
// apply, cookies are first-party, so Google SSO / 2FA logins work and persist
// in the 'persist:tools' partition. See ADR-0009.

const {
  app,
  BrowserWindow,
  WebContentsView,
  clipboard,
  ipcMain,
  Menu,
  session,
  shell,
} = require("electron")
const path = require("node:path")
const { autoUpdater } = require("electron-updater")

const APP_URL =
  process.env.APP_URL || "https://project-z4cpw-vini-s-projects10.vercel.app"
const TOOLS_PARTITION = "persist:tools"

// Google blocks OAuth in webviews that identify as Electron ("This browser or
// app may not be secure"). Present a plain Chrome UA everywhere — required for
// the app's own Supabase Google login AND for Fadmin's @fanvue Google login.
const UA_PLATFORM = {
  darwin: "Macintosh; Intel Mac OS X 10_15_7",
  win32: "Windows NT 10.0; Win64; x64",
  linux: "X11; Linux x86_64",
}[process.platform]
const CHROME_UA = `Mozilla/5.0 (${UA_PLATFORM}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`

/** @type {BrowserWindow | null} */
let win = null
/** @type {Map<string, WebContentsView>} */
const toolViews = new Map()

function sendToolEvent(id, kind, value) {
  if (win && !win.isDestroyed()) {
    win.webContents.send("canvas:tool-event", { id, kind, value })
  }
}

function openTool(id, url) {
  if (!win || toolViews.has(id)) return
  const view = new WebContentsView({
    webPreferences: {
      partition: TOOLS_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  view.setBounds({ x: 0, y: 0, width: 0, height: 0 })
  view.setVisible(false)
  win.contentView.addChildView(view)

  const wc = view.webContents
  // OAuth flows (Google SSO, 2FA confirmation pages) may open popups; they
  // must stay in the tools session or the login is lost. Allow them as real
  // child windows sharing the partition.
  wc.setWindowOpenHandler(() => ({
    action: "allow",
    overrideBrowserWindowOptions: {
      autoHideMenuBar: true,
      webPreferences: {
        partition: TOOLS_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    },
  }))
  wc.on("page-title-updated", (_e, title) => sendToolEvent(id, "title", title))
  wc.on("did-start-loading", () => sendToolEvent(id, "loading", true))
  wc.on("did-stop-loading", () => sendToolEvent(id, "loading", false))
  // Keep the card's URL bar in sync with what the view actually loads
  // (redirects, SSO hops, in-app navigation).
  wc.on("did-navigate", (_e, url) => sendToolEvent(id, "url", url))
  wc.on("did-navigate-in-page", (_e, url) => sendToolEvent(id, "url", url))

  // Ctrl/Cmd+F is pressed while focus is inside this native view, so the React
  // renderer never sees it — intercept here and ask the card to open its find
  // bar. Escape closes it. (The actual search runs via the canvas:find IPC.)
  wc.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return
    if ((input.control || input.meta) && input.key.toLowerCase() === "f") {
      event.preventDefault()
      sendToolEvent(id, "find-open", true)
    }
  })

  // Forward in-page find results to the card's find bar.
  wc.on("found-in-page", (_e, result) =>
    sendToolEvent(id, "find-result", {
      active: result.activeMatchOrdinal,
      total: result.matches,
    }),
  )

  // Chrome-like right-click menu. The key use case is reverse-searching media
  // (stolen images uploaded to Fanvue) via Google Lens. Lens fetches the URL
  // anonymously, so it works for public/CDN-signed image URLs; auth-only images
  // may 403 — "Copy/Save image" is the fallback there.
  wc.on("context-menu", (_e, params) => {
    const items = []
    const isImage = params.mediaType === "image" && params.srcURL

    if (isImage) {
      items.push({
        label: "Pesquisar imagem no Google Lens",
        click: () =>
          shell.openExternal(
            `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(params.srcURL)}`,
          ),
      })
      items.push({
        label: "Copiar imagem",
        click: () => wc.copyImageAt(params.x, params.y),
      })
      items.push({
        label: "Copiar endereço da imagem",
        click: () => clipboard.writeText(params.srcURL),
      })
      items.push({
        label: "Abrir imagem em nova guia",
        click: () => shell.openExternal(params.srcURL),
      })
      items.push({ type: "separator" })
    }

    if (params.selectionText) {
      const text = params.selectionText.trim().slice(0, 80)
      items.push({
        label: "Copiar",
        role: "copy",
      })
      items.push({
        label: `Pesquisar "${text}" no Google`,
        click: () =>
          shell.openExternal(
            `https://www.google.com/search?q=${encodeURIComponent(params.selectionText)}`,
          ),
      })
      items.push({ type: "separator" })
    }

    if (params.isEditable) {
      items.push({ label: "Recortar", role: "cut" })
      items.push({ label: "Colar", role: "paste" })
      items.push({ type: "separator" })
    }

    items.push({ label: "Recarregar", click: () => wc.reload() })
    items.push({
      label: "Inspecionar elemento",
      click: () => wc.inspectElement(params.x, params.y),
    })

    Menu.buildFromTemplate(items).popup({ window: win })
  })

  toolViews.set(id, view)
  wc.loadURL(url)
}

function closeTool(id) {
  const view = toolViews.get(id)
  if (!view || !win) return
  toolViews.delete(id)
  win.contentView.removeChildView(view)
  view.webContents.close()
}

function closeAllTools() {
  for (const id of [...toolViews.keys()]) closeTool(id)
}

function registerIpc() {
  ipcMain.handle("canvas:open-tool", (_e, { id, url }) => {
    if (typeof id !== "string" || typeof url !== "string") return
    if (!/^https?:\/\//.test(url)) return
    openTool(id, url)
  })
  ipcMain.on("canvas:close-tool", (_e, { id }) => closeTool(id))
  ipcMain.on("canvas:close-all", () => closeAllTools())
  ipcMain.on("canvas:set-bounds", (_e, { id, bounds, zoom }) => {
    const view = toolViews.get(id)
    if (!view || !bounds) return
    view.setBounds({
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.max(0, Math.round(bounds.width)),
      height: Math.max(0, Math.round(bounds.height)),
    })
    if (typeof zoom === "number" && Number.isFinite(zoom)) {
      view.webContents.setZoomFactor(Math.min(5, Math.max(0.25, zoom)))
    }
  })
  ipcMain.on("canvas:set-visible", (_e, { id, visible }) => {
    toolViews.get(id)?.setVisible(Boolean(visible))
  })
  ipcMain.on("canvas:reload", (_e, { id }) => {
    toolViews.get(id)?.webContents.reload()
  })
  ipcMain.on("canvas:navigate", (_e, { id, url }) => {
    if (typeof url !== "string" || !/^https?:\/\//.test(url)) return
    toolViews.get(id)?.webContents.loadURL(url)
  })
  ipcMain.on("canvas:find", (_e, { id, text, forward, findNext }) => {
    const view = toolViews.get(id)
    if (!view || typeof text !== "string" || !text) return
    view.webContents.findInPage(text, {
      forward: forward !== false,
      findNext: Boolean(findNext),
    })
  })
  ipcMain.on("canvas:stop-find", (_e, { id }) => {
    toolViews.get(id)?.webContents.stopFindInPage("clearSelection")
  })
}

function createWindow() {
  win = new BrowserWindow({
    width: 1500,
    height: 950,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  win.once("ready-to-show", () => win.show())

  // Main app window: regular external links go to the default browser.
  // (Supabase Google login is a full-page redirect, not a popup, so this is
  // safe for the auth flow.)
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: "deny" }
  })

  // Page navigations (route changes) drop all native views — the renderer
  // re-opens the ones the new page needs. Prevents stranded views over the UI.
  win.webContents.on("did-start-navigation", (details) => {
    if (details.isMainFrame && !details.isSameDocument) closeAllTools()
  })
  win.on("closed", () => {
    win = null
    toolViews.clear()
  })

  win.loadURL(APP_URL)
}

// Shell auto-update: the UI is served from Vercel (updates instantly), so the
// only thing that ever needs a new binary is this Electron shell. On launch a
// packaged build checks the GitHub Releases feed (latest*.yml published by
// electron-builder) and, if a newer version exists, downloads it in the
// background and installs it on the next quit. Dev runs skip this — there's no
// update feed and autoUpdater would throw.
function initAutoUpdate() {
  if (!app.isPackaged) return
  autoUpdater.autoDownload = true
  autoUpdater.on("error", (err) => {
    console.error("[autoUpdater]", err?.message ?? err)
  })
  autoUpdater.checkForUpdatesAndNotify().catch((err) => {
    console.error("[autoUpdater] check failed", err?.message ?? err)
  })
}

app.whenReady().then(() => {
  app.userAgentFallback = CHROME_UA
  session.fromPartition(TOOLS_PARTITION).setUserAgent(CHROME_UA)
  registerIpc()
  createWindow()
  initAutoUpdate()

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})
