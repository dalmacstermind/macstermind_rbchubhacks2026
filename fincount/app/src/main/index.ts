// Electron main process: opens the window, starts the Python back end, and does the few
// things only a desktop app can (file pickers, Save dialogs, PDF export).
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { basename, extname, join } from "node:path";
import type { BackendInfo, PickedFile, SkippedFile } from "../shared/api";

let win: BrowserWindow | null = null;
let backend: ChildProcess | null = null;
let backendInfo: Promise<BackendInfo>;

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
 * Installed app: runs resources/backend/fincount-api.exe on a free port with a random token.
 * Development:   uses the back end at FINCOUNT_API_URL (default http://127.0.0.1:8765) if it's
 *                already running; otherwise starts ../backend with Python for you.
 */
async function startBackend(): Promise<BackendInfo> {
  const dataDir = app.getPath("userData");

  if (!app.isPackaged) {
    const url = process.env.FINCOUNT_API_URL ?? "http://127.0.0.1:8765";
    if (await isHealthy(url, "")) return { url, token: "" }; // you started it yourself (uvicorn --reload)
    const dir = join(app.getAppPath(), "..", "backend");
    const venvPython = join(dir, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
    const python = existsSync(venvPython) ? venvPython : process.platform === "win32" ? "python" : "python3";
    const port = Number(new URL(url).port || 8765);
    return launch(python, ["run.py", "--port", String(port), "--data-dir", join(dataDir, "dev-data")], dir, port, "");
  }

  const exe = join(
    process.resourcesPath,
    "backend",
    process.platform === "win32" ? "fincount-api.exe" : "fincount-api",
  );
  const port = await freePort();
  const token = randomBytes(24).toString("hex");
  return launch(exe, ["--port", String(port), "--data-dir", dataDir], undefined, port, token);
}

async function launch(cmd: string, args: string[], cwd: string | undefined, port: number, token: string) {
  const url = `http://127.0.0.1:${port}`;
  let output = "";
  backend = spawn(cmd, args, { cwd, env: { ...process.env, FINCOUNT_TOKEN: token }, windowsHide: true });
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
      headers: { "X-FinCount-Token": token },
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
    title: "FinCount",
    backgroundColor: "#0b1620",
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
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(join(__dirname, "../renderer/index.html"));
}

// Only one copy of FinCount at a time (two would fight over the database).
if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => {
  if (win?.isMinimized()) win.restore();
  win?.focus();
});

app.setAppUserModelId("org.fincount.app"); // needed for Windows notifications
// Fully offline: no background calls home from Chromium.
app.commandLine.appendSwitch("disable-component-update");
app.commandLine.appendSwitch("disable-background-networking");

app.whenReady().then(() => {
  backendInfo = startBackend(); // the window shows "Starting FinCount…" until this is ready
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
  ipcMain.on("shell:open", (_e, path: string) => void shell.openPath(path));

  ipcMain.handle("export:pdf", async (e, name: string) => {
    const r = await dialog.showSaveDialog(win!, {
      title: "Save report as PDF",
      defaultPath: join(app.getPath("documents"), `${name}.pdf`),
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (r.canceled || !r.filePath) return null;
    const pdf = await e.sender.printToPDF({ printBackground: true, pageSize: "Letter", landscape: true });
    writeFileSync(r.filePath, pdf);
    return r.filePath;
  });
}

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
