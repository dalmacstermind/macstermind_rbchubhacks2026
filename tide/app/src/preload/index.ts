// The bridge between the screens and Electron. Only desktop-only features live here;
// everything else goes to the FastAPI back end over HTTP (see src/renderer/src/api.ts).
import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { DesktopApi } from "../shared/api";

const desktop: DesktopApi = {
  backend: () => ipcRenderer.invoke("backend:info"),
  onBackendCrashed: (cb) => ipcRenderer.on("backend:crashed", (_e, msg: string) => cb(msg)),
  pickFiles: () => ipcRenderer.invoke("files:pick"),
  pickFolder: () => ipcRenderer.invoke("files:pickFolder"),
  pickImages: () => ipcRenderer.invoke("files:pickImages"),
  pickCsv: () => ipcRenderer.invoke("files:pickCsv"),
  pathsOf: (files) => files.map((f) => webUtils.getPathForFile(f)).filter(Boolean),
  expand: (paths) => ipcRenderer.invoke("files:expand", paths),
  saveXlsx: (name, data) => ipcRenderer.invoke("export:xlsx", name, data),
  savePdf: (name) => ipcRenderer.invoke("export:pdf", name),
  setProgress: (fraction) => ipcRenderer.send("taskbar:progress", fraction),
  setCounting: (videos) => ipcRenderer.send("counting:set", videos),
  focusWindow: () => ipcRenderer.send("window:focus"),
  openPath: (path) => ipcRenderer.send("shell:open", path),
};

contextBridge.exposeInMainWorld("desktop", desktop);
