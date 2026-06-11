// Minimal bridge between the canvas page (React, served from Vercel) and the
// main process. The web app detects desktop mode by the presence of
// window.canvasHost — see web/lib/canvas-host.ts for the typed counterpart.

const { contextBridge, ipcRenderer } = require("electron")

contextBridge.exposeInMainWorld("canvasHost", {
  version: 1,
  openTool: (id, url) => ipcRenderer.invoke("canvas:open-tool", { id, url }),
  closeTool: (id) => ipcRenderer.send("canvas:close-tool", { id }),
  closeAllTools: () => ipcRenderer.send("canvas:close-all"),
  setToolBounds: (id, bounds, zoom) =>
    ipcRenderer.send("canvas:set-bounds", { id, bounds, zoom }),
  setToolVisible: (id, visible) =>
    ipcRenderer.send("canvas:set-visible", { id, visible }),
  reloadTool: (id) => ipcRenderer.send("canvas:reload", { id }),
  navigateTool: (id, url) => ipcRenderer.send("canvas:navigate", { id, url }),
  onToolEvent: (cb) => {
    const handler = (_event, payload) => cb(payload)
    ipcRenderer.on("canvas:tool-event", handler)
    return () => ipcRenderer.removeListener("canvas:tool-event", handler)
  },
})
