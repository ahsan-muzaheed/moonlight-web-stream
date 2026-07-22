@echo off
setlocal

cd /d C:\Users\e3ds\Desktop\moonlight-web-stream

call npm run build-light
if errorlevel 1 (
    echo.
    echo BUILD FAILED - not copying. See errors above.
    pause
    exit /b 1
)

:: merge dist -> node-streamer-proxy\static (overwrite matching files, keep extras)
xcopy ".\dist" ".\node-streamer-proxy\static" /E /I /Y
if errorlevel 4 (
    echo.
    echo COPY FAILED ^(xcopy code %errorlevel%^).
    pause
    exit /b 1
)

echo.
echo Build + deploy done.
pause