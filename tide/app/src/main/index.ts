// Electron main process: opens the window, starts the Python back end, and does the few
// things only a desktop app can (file pickers, Save dialogs, PDF export).
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { basename, extname, join } from "node:path";
import type { BackendInfo, PickedFile, SkippedFile } from "../shared/api";

// TIDE keeps its data (surveys, database, saved settings) in %APPDATA%\TIDE. Earlier versions were
// called FinCount and used %APPDATA%\FinCount: move that folder over once, before anything opens it,
// so earlier surveys carry over. If it can't be moved (for example a file in it is open), TIDE starts
// with a new folder and leaves the old one untouched.
function moveOldDataFolder(appData: string): void {
  const oldDir = join(appData, "FinCount");
  const newDir = join(appData, "TIDE");
  if (!existsSync(oldDir) || existsSync(newDir)) return;
  try {
    renameSync(oldDir, newDir);
  } catch (e) {
    console.error(`Couldn't move ${oldDir} to ${newDir}; starting with a new data folder.`, e);
  }
}
moveOldDataFolder(app.getPath("appData"));
app.setPath("userData", join(app.getPath("appData"), "TIDE"));

let win: BrowserWindow | null = null;
let backend: ChildProcess | null = null;
let backendInfo: Promise<BackendInfo>;
let countingVideos = 0; // videos waiting or being counted (the screens keep this up to date)

/* ───────────── Back end ───────────── */

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
  });

/**
 * Installed app: runs resources/backend/tide-api.exe on a free port with a random token.
 * Development:   uses the back end at TIDE_API_URL (default http://127.0.0.1:8765) if it's
 *                already running; otherwise starts ../backend with Python for you.
 */
async function startBackend(): Promise<BackendInfo> {
  const dataDir = app.getPath("userData"); // %APPDATA%\TIDE, pinned at the top of this file

  if (!app.isPackaged) {
    const url = process.env.TIDE_API_URL ?? "http://127.0.0.1:8765";
    if (await isHealthy(url, "")) return { url, token: "" }; // you started it yourself (uvicorn --reload)
    const dir = join(app.getAppPath(), "..", "backend");
    const venvPython = join(dir, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
    const python = existsSync(venvPython) ? venvPython : process.platform === "win32" ? "python" : "python3";
    const port = Number(new URL(url).port || 8765);
    return launch(python, ["run.py", "--port", String(port), "--data-dir", join(dataDir, "dev-data")], dir, port, "");
  }

  const exe = join(process.resourcesPath, "backend", process.platform === "win32" ? "tide-api.exe" : "tide-api");
  const port = await freePort();
  const token = randomBytes(24).toString("hex");
  return launch(exe, ["--port", String(port), "--data-dir", dataDir], undefined, port, token);
}

async function launch(cmd: string, args: string[], cwd: string | undefined, port: number, token: string) {
  const url = `http://127.0.0.1:${port}`;
  let output = "";
  backend = spawn(cmd, args, { cwd, env: { ...process.env, TIDE_TOKEN: token }, windowsHide: true });
  backend.stdout?.on("data", (d) => (output = (output + d).slice(-3000)));
  backend.stderr?.on("data", (d) => (output = (output + d).slice(-3000)));
  const exited = new Promise<string>((resolve) => {
    backend!.once("error", (e) => resolve(`Couldn't start the back end (${cmd}): ${e.message}`));
    backend!.once("exit", (code) => resolve(`The back end stopped (exit code ${code}).\n${output}`));
  });
  // The packaged back end takes a few seconds to start: wait up to 60s for /health.
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const early = await Promise.race([exited, sleep(300).then(() => null)]);
    if (early) return { url, token, error: early };
    if (await isHealthy(url, token)) {
      void exited.then((msg) => win?.webContents.send("backend:crashed", msg));
      return { url, token };
    }
  }
  return { url, token, error: `The back end didn't start within 60 seconds.\n${output}` };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function isHealthy(url: string, token: string) {
  try {
    const r = await fetch(`${url}/health`, {
      headers: { "X-TIDE-Token": token },
      signal: AbortSignal.timeout(1000),
    });
    return r.ok;
  } catch {
    return false;
  }
}

/* ───────────── Window ───────────── */

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: "TIDE",
    backgroundColor: WINDOW_BACKGROUND,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
      contextIsolation: true,
      spellcheck: false, // otherwise Chromium downloads spelling dictionaries from the internet
    },
  });
  win.once("ready-to-show", () => win?.show());
  // Counting stops with the app and nothing of it is kept, so ask before closing in the middle of one.
  win.on("close", (e) => {
    if (!countingVideos) return;
    const choice = dialog.showMessageBoxSync(win!, {
      type: "warning",
      title: "TIDE is still counting",
      message: "TIDE is still counting. Close it anyway?",
      detail: "Counting stops when TIDE closes and nothing of the unfinished count is kept. You'd have to count again.",
      buttons: ["Keep counting", "Close TIDE"],
      defaultId: 0,
      cancelId: 0,
    });
    if (choice === 0) e.preventDefault();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(join(__dirname, "../renderer/index.html"));
}

function bringWindowForward() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.moveTop();
  win.focus();
}

// Only one copy of TIDE at a time (two would fight over the database).
if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", bringWindowForward);

app.setAppUserModelId("org.tide.app"); // needed for Windows notifications
// Fully offline: no background calls home from Chromium.
app.commandLine.appendSwitch("disable-component-update");
app.commandLine.appendSwitch("disable-background-networking");

app.whenReady().then(() => {
  backendInfo = startBackend(); // the window shows "Starting TIDE…" until this is ready
  registerIpc();
  createWindow();
});

app.on("window-all-closed", () => app.quit());
app.on("will-quit", () => backend?.kill());

/* ───────────── Desktop-only features for the screens ───────────── */

function registerIpc() {
  ipcMain.handle("backend:info", () => backendInfo);

  ipcMain.handle("files:pick", async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: "Choose survey footage",
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "Videos and photos", extensions: [...VIDEO, ...PHOTO].map((e) => e.slice(1)) }],
    });
    return r.filePaths;
  });

  ipcMain.handle("files:pickImages", async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: "Choose reference pictures of this species",
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "Pictures", extensions: PHOTO.map((e) => e.slice(1)) }],
    });
    return r.filePaths;
  });

  ipcMain.handle("files:pickCsv", async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: "Choose the hand counts (CSV: video, point, total_fish)",
      properties: ["openFile"],
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    return r.filePaths[0] ?? null;
  });

  ipcMain.handle("files:pickFolder", async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: "Choose a folder of survey footage",
      properties: ["openDirectory"],
    });
    return r.filePaths;
  });

  ipcMain.handle("files:expand", (_e, paths: string[]) => expand(paths));

  ipcMain.handle("export:xlsx", async (_e, name: string, data: ArrayBuffer) => {
    const r = await dialog.showSaveDialog(win!, {
      title: "Save Excel workbook",
      defaultPath: join(app.getPath("documents"), `${name}.xlsx`),
      filters: [{ name: "Excel workbook", extensions: ["xlsx"] }],
    });
    if (r.canceled || !r.filePath) return null;
    writeFileSync(r.filePath, Buffer.from(data));
    return r.filePath;
  });

  ipcMain.on("taskbar:progress", (_e, fraction: number | null) => win?.setProgressBar(fraction ?? -1));
  ipcMain.on("counting:set", (_e, videos: number) => (countingVideos = videos));
  ipcMain.on("window:focus", bringWindowForward);
  ipcMain.on("shell:open", (_e, path: string) => void shell.openPath(path));

  ipcMain.handle("export:pdf", async (e, name: string) => {
    const r = await dialog.showSaveDialog(win!, {
      title: "Save report as PDF",
      defaultPath: join(app.getPath("documents"), `${name}.pdf`),
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (r.canceled || !r.filePath) return null;
    // The page margins are painted in the window's own background colour, so print on white paper.
    win!.setBackgroundColor("#ffffff");
    try {
      const pdf = await e.sender.printToPDF({
        printBackground: true,
        pageSize: "Letter",
        margins: { top: 0.45, bottom: 0.7, left: 0.5, right: 0.5 },
        displayHeaderFooter: true,
        headerTemplate: "<span></span>",
        footerTemplate: REPORT_FOOTER,
      });
      writeFileSync(r.filePath, pdf);
    } finally {
      win!.setBackgroundColor(WINDOW_BACKGROUND);
    }
    return r.filePath;
  });
}

const WINDOW_BACKGROUND = "#0b1620"; // shown behind the page while the app starts

// Printed at the bottom of every page of the PDF report. Chromium fills in the page numbers.
const REPORT_FOOTER = `<div style="width:100%;margin:0 0.5in;display:flex;justify-content:space-between;
font:8px Helvetica,Arial,sans-serif;color:#5b7480"><span>* Adult and juvenile counts are not recorded in this prototype of TIDE.</span>
<span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`;

/* ───────────── Folders and file types ───────────── */

const VIDEO = [".mp4", ".mov", ".avi", ".mkv"];
const PHOTO = [".jpg", ".jpeg", ".png", ".tif", ".tiff"];
const SYSTEM = /^(\.|__MACOSX$|Thumbs\.db$|desktop\.ini$)/i;

/** Folders are opened (including sub-folders); anything that isn't footage is listed with a reason. */
function expand(paths: string[]) {
  const files: PickedFile[] = [];
  const skipped: SkippedFile[] = [];
  const visit = (p: string, rel: string) => {
    const name = basename(p);
    if (SYSTEM.test(name)) return skipped.push({ name: rel, reason: "System file" });
    let st;
    try {
      st = statSync(p);
    } catch {
      return skipped.push({ name: rel, reason: "Can't be opened" });
    }
    if (st.isDirectory()) {
      for (const child of readdirSync(p).sort()) visit(join(p, child), `${rel}/${child}`);
      return;
    }
    const ext = extname(name).toLowerCase();
    if (ext === ".zip") return skipped.push({ name: rel, reason: "ZIP files: please unzip first" });
    if (![...VIDEO, ...PHOTO].includes(ext)) return skipped.push({ name: rel, reason: "Not a video or photo" });
    files.push({ path: p, name: rel, size: st.size });
  };
  for (const p of paths) visit(p, basename(p));
  return { files, skipped };
}
