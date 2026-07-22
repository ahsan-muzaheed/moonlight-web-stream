@echo off
setlocal enableextensions
rem ============================================================
rem  install-startup.bat
rem
rem  Put this file in the ROOT folder that contains "run ss.bat"
rem  (e.g. ...\moonlight-web-stream\node-streamer-proxy\).
rem  Then double-click it (or run from a cmd in that folder).
rem
rem  It creates a shortcut in your Startup folder so the streamer
rem  launches automatically at login. The shortcut sets the
rem  correct "Start in" folder, which Sunshine REQUIRES (its
rem  shader/asset paths are relative to the working directory).
rem ============================================================

rem --- root = folder this .bat lives in (no trailing backslash)
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

set "STREAMER_BAT=%ROOT%\run ss.bat"
set "STREAMER_DIR=%ROOT%"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"

echo Root folder  : %ROOT%
echo Working dir  : %STREAMER_DIR%
echo Startup dir  : %STARTUP%
echo.

if not exist "%STARTUP%" mkdir "%STARTUP%"

rem --- verify the target exists before touching anything ---
if not exist "%STREAMER_BAT%" (
    echo [ERROR] Not found: %STREAMER_BAT%
    echo Run this .bat from the correct root folder.
    goto :fail
)

rem --- Streamer shortcut (WindowStyle 7 = minimized) ---
powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('%STARTUP%\ss_sunshine.lnk'); $s.TargetPath='%STREAMER_BAT%'; $s.WorkingDirectory='%STREAMER_DIR%'; $s.WindowStyle=7; $s.Description='moonlight-web-stream streamer (auto-start)'; $s.Save()"
if errorlevel 1 goto :fail

echo [OK] ss_sunshine.lnk -^> %STREAMER_BAT%
echo      Start in    -^> %STREAMER_DIR%
echo.
echo Done. It will launch at next login.
echo   Remove auto-start : del  "%STARTUP%\ss_sunshine.lnk"
echo.
echo Opening the Startup folder...
explorer "%STARTUP%"
goto :done

:fail
echo.
echo Setup FAILED (or only partly applied). See messages above.
endlocal
exit /b 1

:done
endlocal
exit /b 0