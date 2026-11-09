@echo off
rem Doppelklick unter Windows: startet RIDEFRAME und oeffnet Chrome.
cd /d "%~dp0"
where node >nul 2>nul && (start "RIDEFRAME" /min node serve.mjs) || (start "RIDEFRAME" /min python -m http.server 8765 --bind 127.0.0.1)
timeout /t 2 >nul
start chrome "http://localhost:8765" || start "" "http://localhost:8765"
