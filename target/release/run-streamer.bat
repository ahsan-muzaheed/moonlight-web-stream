@echo off
REM Keeps the streamer running: relaunch whenever it exits (e.g. after a stream ends).
:loop

::set MOONLIGHT_FIRST_FRAME_TIMEOUT_SECS=120

echo [runner] starting streamer...
".\streamer.exe"
echo [runner] streamer exited, restarting in 1s...
::timeout /t 1 /nobreak >nul
goto loop