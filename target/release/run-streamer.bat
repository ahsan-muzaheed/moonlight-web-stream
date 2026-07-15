@echo off
REM Keeps the streamer running: relaunch whenever it exits (e.g. after a stream ends).
:loop
echo [runner] starting streamer...
".\streamer.exe"
echo [runner] streamer exited, restarting in 1s...
timeout /t 1 /nobreak >nul
goto loop