const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');

const isDev = process.env.NODE_ENV !== 'production' && !app.isPackaged;

let mainWindow = null;
let pythonProcess = null;

function getProjectRoot() {
  // Running from source (dev OR production-mode `electron .`): the repo root is
  // one level above electron/. Only a truly packaged build lives next to the exe.
  if (!app.isPackaged) {
    return path.join(__dirname, '..');
  }
  return path.dirname(app.getPath('exe'));
}

function startPythonBackend() {
  const projectRoot = getProjectRoot();

  // Run as a module from the project root so the `backend` package is importable
  // (running `python backend/main.py` directly puts backend/ on sys.path, which
  // breaks `from backend... import ...`). Matches the manual uvicorn invocation.
  pythonProcess = spawn(
    'python',
    ['-m', 'uvicorn', 'backend.main:app', '--host', '127.0.0.1', '--port', '8787'],
    {
      cwd: projectRoot,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONPATH: projectRoot },
      stdio: ['pipe', 'pipe', 'pipe'],
    }
  );

  pythonProcess.stdout.on('data', (data) => {
    console.log(`[Python] ${data.toString().trim()}`);
  });

  pythonProcess.stderr.on('data', (data) => {
    console.error(`[Python Error] ${data.toString().trim()}`);
  });

  pythonProcess.on('error', (err) => {
    console.error('Failed to start Python backend:', err.message);
    if (mainWindow) {
      mainWindow.webContents.send('backend-error', err.message);
    }
  });

  pythonProcess.on('close', (code) => {
    console.log(`Python backend exited with code ${code}`);
    pythonProcess = null;
  });
}

// Backend import pulls in torch + ultralytics, which can take 20-40s on a cold
// start, so allow generous headroom before declaring it unreachable.
function waitForBackend(retries = 120, interval = 500) {
  return new Promise((resolve, reject) => {
    let attempts = 0;

    function check() {
      attempts++;
      const req = http.get('http://localhost:8787/api/health', (res) => {
        if (res.statusCode === 200) {
          resolve();
        } else if (attempts < retries) {
          setTimeout(check, interval);
        } else {
          reject(new Error('Backend health check failed'));
        }
      });

      req.on('error', () => {
        if (attempts < retries) {
          setTimeout(check, interval);
        } else {
          reject(new Error(`Backend not reachable after ${retries} retries`));
        }
      });

      req.setTimeout(2000, () => {
        req.destroy();
        if (attempts < retries) {
          setTimeout(check, interval);
        } else {
          reject(new Error('Backend health check timeout'));
        }
      });
    }

    check();
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 800,
    show: false,
    frame: true,
    title: 'LabelHub — Инструмент аннотации',
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: isDev,
    },
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  const url = isDev
    ? 'http://localhost:5173'
    : `file://${path.join(__dirname, 'dist', 'index.html')}`;

  mainWindow.loadURL(url);

  if (isDev) {
    mainWindow.webContents.openDevTools();
  }
}

function setupIpcHandlers() {
  ipcMain.handle('select-video-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Выберите видео файл',
      filters: [
        { name: 'Видео файлы', extensions: ['mp4', 'avi', 'mov', 'mkv', 'webm'] },
      ],
      properties: ['openFile'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('select-model-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Выберите файл весов модели',
      filters: [
        { name: 'Веса PyTorch', extensions: ['pt'] },
      ],
      properties: ['openFile'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('select-image-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Выберите изображение',
      filters: [
        { name: 'Изображения', extensions: ['jpg', 'jpeg', 'png', 'bmp'] },
      ],
      properties: ['openFile'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('select-directory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Выберите папку',
      properties: ['openDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('select-save-location', async (event, defaultName) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Выберите путь для сохранения',
      defaultPath: defaultName,
      filters: [
        { name: 'ZIP Архивы', extensions: ['zip'] },
      ],
    });
    return result.canceled ? null : result.filePath;
  });

  ipcMain.handle('get-app-path', () => {
    return getProjectRoot();
  });

  ipcMain.handle('get-platform', () => {
    return process.platform;
  });

  ipcMain.handle('open-external', async (event, url) => {
    // Only allow opening local TensorBoard / http(s) links in the system browser.
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      await shell.openExternal(url);
      return true;
    }
    return false;
  });
}

app.whenReady().then(async () => {
  setupIpcHandlers();
  startPythonBackend();

  try {
    await waitForBackend();
    console.log('Backend is ready');
    createWindow();
  } catch (err) {
    console.error('Failed to connect to backend:', err.message);
    createWindow();
    if (mainWindow) {
      mainWindow.webContents.on('did-finish-load', () => {
        mainWindow.webContents.send('backend-error', err.message);
      });
    }
  }
});

app.on('window-all-closed', () => {
  if (pythonProcess) {
    pythonProcess.kill();
    pythonProcess = null;
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (pythonProcess) {
    pythonProcess.kill();
    pythonProcess = null;
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
