const { app, BrowserWindow, shell, Menu } = require("electron");
const path = require("path");
const http = require("http");
const { spawn, exec } = require("child_process");
const fs = require("fs");

let mainWindow = null;
let pythonProcess = null;
let spawnedBackend = false;

const ROOT_DIR = path.resolve(__dirname, "..", "..");
const VENV_PYTHON = path.join(ROOT_DIR, ".venv", "Scripts", "python.exe");
const BACKEND_PORT = 8000;
const HEALTH_URL = `http://127.0.0.1:${BACKEND_PORT}/api/v1/health`;
const DEV_URL = "http://localhost:5173";

function checkBackendHealth() {
  return new Promise((resolve) => {
    const req = http.get(HEALTH_URL, { timeout: 1500 }, (res) => {
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

async function startBackend() {
  const isAlreadyRunning = await checkBackendHealth();
  if (isAlreadyRunning) {
    console.log("[Electron] Backend FastAPI já está em execução na porta 8000.");
    return;
  }

  const pythonExecutable = fs.existsSync(VENV_PYTHON) ? VENV_PYTHON : "python";
  console.log(`[Electron] Iniciando Backend FastAPI com: ${pythonExecutable}`);

  pythonProcess = spawn(
    pythonExecutable,
    ["-m", "src.core.infrastructure.web.main"],
    {
      cwd: ROOT_DIR,
      env: {
        ...process.env,
        PYTHONPATH: ".",
      },
      stdio: "pipe",
    }
  );

  spawnedBackend = true;

  pythonProcess.stdout?.on("data", (data) => {
    console.log(`[Python stdout] ${data.toString().trim()}`);
  });

  pythonProcess.stderr?.on("data", (data) => {
    console.warn(`[Python stderr] ${data.toString().trim()}`);
  });

  pythonProcess.on("close", (code) => {
    console.log(`[Electron] Processo Python encerrou com código: ${code}`);
    pythonProcess = null;
  });

  // Aguarda até 15s para a API estar saudável
  const startTime = Date.now();
  while (Date.now() - startTime < 15000) {
    await new Promise((res) => setTimeout(res, 500));
    if (await checkBackendHealth()) {
      console.log("[Electron] Backend FastAPI está pronto e respondendo!");
      return;
    }
  }
  console.warn("[Electron] Tempo limite excedido ao aguardar o backend.");
}

function killPythonProcess() {
  if (spawnedBackend && pythonProcess && pythonProcess.pid) {
    console.log(`[Electron] Encerrando backend Python (PID: ${pythonProcess.pid})...`);
    if (process.platform === "win32") {
      try {
        exec(`taskkill /pid ${pythonProcess.pid} /T /F`);
      } catch (_) {}
    } else {
      try {
        pythonProcess.kill("SIGTERM");
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
      webSecurity: false,
    },
  });

  mainWindow.maximize();

  // Links externos abrem no navegador padrão do SO
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
      console.log(`[Electron] Bundle dist não encontrado, fallback para Vite Dev: ${DEV_URL}`);
      await mainWindow.loadURL(DEV_URL);
    } else {
      console.error("[Electron] Nem o bundle dist/ nem o servidor Vite foram encontrados.");
    }
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// Inicialização da aplicação Electron
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
