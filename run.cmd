@echo off
REM Launch LabelHub (Windows). Activates the venv created by install.cmd
REM (if present) so the bundled Python deps are used, then starts the app.
cd /d "%~dp0"
if exist ".venv\Scripts\activate.bat" call ".venv\Scripts\activate.bat"
call "electron\launch.cmd"
