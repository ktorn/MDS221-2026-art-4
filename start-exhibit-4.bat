@echo off
setlocal

REM Starts/restarts the exhibition kiosk on Windows.
REM Put this file in Task Scheduler with a daily 7:00 AM trigger.

set "PROJECT=%~dp0"
set "DIGITAL_DIR=%PROJECT%digital"
set "PORT=8000"
set "URL=http://localhost:%PORT%"
set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"

REM Screen 1 (actual kiosk display) is left of the primary virtual screen.
REM Portrait resolution: 1080 x 1920.
set "KIOSK_X=-1080"
set "KIOSK_Y=0"
set "KIOSK_W=1080"
set "KIOSK_H=1920"

if not exist "%CHROME%" (
  set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
)

if not exist "%CHROME%" (
  echo Chrome not found. Update CHROME in start-exhibit-4.bat.
  exit /b 1
)

REM Start Python server only if the port is not already listening.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$port=%PORT%; $digital='%DIGITAL_DIR%'; $listening=Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue; if (-not $listening) { if (Get-Command py -ErrorAction SilentlyContinue) { Start-Process py -ArgumentList '-3','-m','http.server','%PORT%' -WorkingDirectory $digital -WindowStyle Minimized } else { Start-Process python -ArgumentList '-m','http.server','%PORT%' -WorkingDirectory $digital -WindowStyle Minimized } }"

REM Restart Chrome to clear long-running browser/canvas/GPU state.
taskkill /F /IM chrome.exe >nul 2>nul

start "MDS Kiosk" "%CHROME%" ^
  --kiosk "%URL%" ^
  --window-position=%KIOSK_X%,%KIOSK_Y% ^
  --window-size=%KIOSK_W%,%KIOSK_H% ^
  --user-data-dir="%PROJECT%kiosk-chrome-profile" ^
  --no-first-run ^
  --disable-session-crashed-bubble ^
  --disable-restore-session-state ^
  --disable-infobars

endlocal
