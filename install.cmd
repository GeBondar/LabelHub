@echo off
REM ============================================================
REM   LabelHub - one-time installer (Windows)
REM   Creates a Python venv, installs backend + frontend deps,
REM   and builds the web bundle. Run it once after cloning.
REM ============================================================
setlocal
cd /d "%~dp0"

echo ============================================
echo   LabelHub installation
echo ============================================

where python >nul 2>nul || (echo [ERROR] Python 3.10+ was not found in PATH. && exit /b 1)
where node   >nul 2>nul || (echo [ERROR] Node.js 18+ was not found in PATH.   && exit /b 1)

echo.
echo [1/4] Creating Python virtual environment (.venv)...
if not exist ".venv\Scripts\python.exe" (
    python -m venv .venv || (echo [ERROR] Could not create venv. && exit /b 1)
)
call ".venv\Scripts\activate.bat"

echo [2/4] Installing backend dependencies (downloads PyTorch - this can take a while)...
python -m pip install --upgrade pip >nul
pip install -r backend\requirements.txt || (echo [ERROR] Backend install failed. && exit /b 1)

echo [3/4] Installing frontend dependencies...
pushd electron
call npm install || (echo [ERROR] npm install failed. && popd && exit /b 1)

echo [4/4] Building the web bundle...
call npm run build:web || (echo [ERROR] Web build failed. && popd && exit /b 1)
popd

echo.
echo ============================================
echo   Done!  Start the app with:   run.cmd
echo ============================================
echo   Optional SAM2 click-to-segment: see the
echo   "Optional: SAM2" section of the README.
echo.
exit /b 0
