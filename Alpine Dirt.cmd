@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22.12 or newer is required. Install Node.js and try again.
  pause
  exit /b 1
)
where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo npm.cmd was not found. Reinstall Node.js with npm included.
  pause
  exit /b 1
)
if not exist "node_modules\socket.io\package.json" goto install_dependencies
if not exist "node_modules\vite\bin\vite.js" goto install_dependencies
goto build_game

:install_dependencies
echo Installing Alpine Dirt dependencies...
call npm.cmd ci
if errorlevel 1 (
  pause
  exit /b 1
)

:build_game
echo Building Alpine Dirt...
call npm.cmd run build
if errorlevel 1 (
  pause
  exit /b 1
)
echo Starting the server and opening Alpine Dirt in your browser...
call npm.cmd start
if errorlevel 1 pause
