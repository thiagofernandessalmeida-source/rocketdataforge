const { app, BrowserWindow, shell, Menu, ipcMain, dialog } = require("electron");
const path = require("path");
const http = require("http");
const net = require("net");
const crypto = require("crypto");
const os = require("os");
const { spawn, execSync } = require("child_process");
const fs = require("fs");

let mainWindow = null;
let pythonProcess = null;
let backendPort = 8000;
let backendToken = "";
let backendLogs = [];

const ROOT_DIR = path.resolve(__dirname, "..", "..");
const VENV_PYTHON = path.join(ROOT_DIR, ".venv", "Scripts", process.platform === "win32" ? "python.exe" : "python");
const DEV_URL = "http://localhost:5173";

/**
 * Encontra uma porta TCP local disponível dinamicamente.
 */
function getFreePort() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.on("error", () => resolve(8000));
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

/**
 * Checa a integridade da API FastAPI no endpoint /api/v1/health.
 */
function checkBackendHealth(port) {
  return new Promise((resolve) => {
    const targetUrl = `http://127.0.0.1:${port}/api/v1/health`;
    const req = http.get(targetUrl, { timeout: 1500 }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

function checkDevServer() {
  return new Promise((resolve) => {
    const req = http.get(DEV_URL, { timeout: 1000 }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

/**
 * Resolve o caminho para o executável do backend.
 */
function resolveBackendExecutable() {
  const binaryName = process.platform === "win32" ? "cellflow-backend.exe" : "cellflow-backend";

  if (app.isPackaged) {
    const candidates = [
      path.join(process.resourcesPath, "backend", "cellflow-backend", binaryName),
      path.join(process.resourcesPath, "backend", binaryName),
      path.join(process.resourcesPath, binaryName),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
  } else {
    // Modo Desenvolvimento: checa se existe build local no packaging/dist
    const localDist = path.join(ROOT_DIR, "packaging", "dist", "backend", "cellflow-backend", binaryName);
    if (fs.existsSync(localDist)) return localDist;
    const directDist = path.join(ROOT_DIR, "dist", "cellflow-backend", binaryName);
    if (fs.existsSync(directDist)) return directDist;
  }
  return null;
}

/**
 * Inicia o backend FastAPI com porta e token seguros.
 */
async function startBackend() {
  // Em dev, se o backend já estiver rodando na porta 8000, reutiliza
  if (!app.isPackaged) {
    const isDevBackendUp = await checkBackendHealth(8000);
    if (isDevBackendUp) {
      console.log("[Electron] Backend FastAPI já está ativo na porta 8000 em modo dev.");
      backendPort = 8000;
      backendToken = process.env.CELLFLOW_TOKEN || "";
      return;
    }
  }

  backendPort = await getFreePort();
  backendToken = crypto.randomBytes(32).toString("hex");

  const cellflowHome =
    process.env.CELLFLOW_HOME ||
    (process.platform === "win32"
      ? path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "CellFlow")
      : path.join(os.homedir(), ".cellflow"));

  try {
    fs.mkdirSync(cellflowHome, { recursive: true });
  } catch (_) {}

  const backendExe = resolveBackendExecutable();
  let spawnCmd;
  let spawnArgs;

  if (backendExe) {
    console.log(`[Electron] Iniciando executável empacotado do backend: ${backendExe}`);
    spawnCmd = backendExe;
    spawnArgs = ["--port", String(backendPort), "--token", backendToken];
  } else {
    // Fallback para Python venv em desenvolvimento
    const pythonExecutable = fs.existsSync(VENV_PYTHON) ? VENV_PYTHON : "python";
    console.log(`[Electron] Iniciando backend via interpretador Python: ${pythonExecutable}`);
    spawnCmd = pythonExecutable;
    spawnArgs = ["-m", "src.core.infrastructure.web.main", "--port", String(backendPort), "--token", backendToken];
  }

  backendLogs = [];

  pythonProcess = spawn(spawnCmd, spawnArgs, {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      CELLFLOW_HOME: cellflowHome,
      CELLFLOW_TOKEN: backendToken,
      CELLFLOW_PORT: String(backendPort),
      PYTHONPATH: ".",
    },
    stdio: "pipe",
  });

  pythonProcess.stdout?.on("data", (data) => {
    const text = data.toString().trim();
    backendLogs.push(`[stdout] ${text}`);
    if (backendLogs.length > 100) backendLogs.shift();
    console.log(`[Backend stdout] ${text}`);
  });

  pythonProcess.stderr?.on("data", (data) => {
    const text = data.toString().trim();
    backendLogs.push(`[stderr] ${text}`);
    if (backendLogs.length > 100) backendLogs.shift();
    console.warn(`[Backend stderr] ${text}`);
  });

  pythonProcess.on("close", (code) => {
    console.log(`[Electron] Processo backend encerrou com código: ${code}`);
    pythonProcess = null;
  });

  // Aguarda até 15s para a API estar saudável (/api/v1/health)
  const startTime = Date.now();
  let isReady = false;
  while (Date.now() - startTime < 15000) {
    await new Promise((res) => setTimeout(res, 500));
    if (await checkBackendHealth(backendPort)) {
      isReady = true;
      console.log(`[Electron] Backend FastAPI pronto e saudável na porta ${backendPort}!`);
      break;
    }
  }

  if (!isReady) {
    const errorDetails = backendLogs.slice(-20).join("\n") || "Nenhum log registrado pelo backend.";
    dialog.showErrorBox(
      "Falha ao Iniciar o Backend do CellFlow",
      `O servidor backend não respondeu na porta ${backendPort} dentro do tempo limite de 15 segundos.\n\nDetalhes dos logs recentes:\n${errorDetails}`
    );
  }
}

/**
 * Encerra o processo do backend de forma segura e determinística.
 */
function killPythonProcess() {
  if (pythonProcess && pythonProcess.pid) {
    const pid = pythonProcess.pid;
    console.log(`[Electron] Encerrando backend (PID: ${pid})...`);
    if (process.platform === "win32") {
      try {
        execSync(`taskkill /pid ${pid} /T /F`, { stdio: "ignore" });
      } catch (_) {}
    } else {
      try {
        pythonProcess.kill("SIGTERM");
        setTimeout(() => {
          if (pythonProcess) {
            try {
              pythonProcess.kill("SIGKILL");
            } catch (_) {}
          }
        }, 3000);
      } catch (_) {}
    }
    pythonProcess = null;
  }
}

async function createMainWindow() {
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: "CellFlow Data Studio",
    backgroundColor: "#0b0f19",
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true, // Segurança estrita habilitada (Fase 4.2)
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  // IPC síncrono e assíncrono para fornecer a porta e o token gerados ao preload e frontend
  ipcMain.on("cellflow:getBackendConfig", (event) => {
    event.returnValue = {
      apiBase: `http://127.0.0.1:${backendPort}/api/v1`,
      token: backendToken,
    };
  });

  ipcMain.handle("cellflow:getConfig", async () => ({
    apiBase: `http://127.0.0.1:${backendPort}/api/v1`,
    token: backendToken,
  }));

  // Handler para seletor nativo de pastas via Electron
  ipcMain.handle("dialog:openDirectory", async (event, defaultPath) => {
    const win = BrowserWindow.getFocusedWindow() || mainWindow;
    const cleanPath = defaultPath ? String(defaultPath).replace(/^["']|["']$/g, "").trim() : undefined;
    const res = await dialog.showOpenDialog(win, {
      title: "Selecione a Pasta Raiz do Workspace",
      defaultPath: cleanPath && fs.existsSync(cleanPath) ? cleanPath : undefined,
      properties: ["openDirectory", "createDirectory"],
    });
    if (!res.canceled && res.filePaths && res.filePaths.length > 0) {
      return res.filePaths[0];
    }
    return null;
  });

  mainWindow.maximize();

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  const isDevFlag = process.argv.includes("--dev");
  const isDevRunning = await checkDevServer();

  if (isDevFlag && isDevRunning) {
    console.log(`[Electron] Carregando frontend Vite Dev: ${DEV_URL}`);
    await mainWindow.loadURL(DEV_URL);
  } else {
    const indexPath = path.join(__dirname, "..", "dist", "index.html");
    if (fs.existsSync(indexPath)) {
      console.log(`[Electron] Carregando bundle de produção: ${indexPath}`);
      await mainWindow.loadFile(indexPath);
    } else if (isDevRunning) {
      console.log(`[Electron] Fallback para Vite Dev: ${DEV_URL}`);
      await mainWindow.loadURL(DEV_URL);
    } else {
      console.error("[Electron] Nem o bundle dist/ nem o servidor Vite foram encontrados.");
    }
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// Ciclo de vida da aplicação Electron
app.whenReady().then(async () => {
  try {
    await startBackend();
  } catch (err) {
    console.error("[Electron] Erro ao iniciar backend:", err);
  }

  await createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("before-quit", () => {
  killPythonProcess();
});

app.on("window-all-closed", () => {
  killPythonProcess();
  if (process.platform !== "darwin") {
    app.quit();
  }
});
