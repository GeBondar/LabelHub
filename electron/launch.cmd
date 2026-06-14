@echo off
rem LabelHub launcher (production mode): builds the web bundle if missing,
rem then runs Electron which loads dist/ and spawns the Python backend itself.
cd /d "%~dp0"

if not exist "dist\index.html" (
  echo Building web bundle...
  call npm run build:web
)

set NODE_ENV=production
call "%~dp0node_modules\.bin\electron.cmd" .
