@echo off
REM ============================================================
REM  streamer-proxy.cmd
REM  Point the web-server's `streamer_path` config at THIS file.
REM  The web-server spawns this with piped stdin/stdout/stderr; cmd launches
REM  node (inheriting those pipes), which launches the real streamer.exe and
REM  relays both ways. See index.js.
REM ============================================================

setlocal

REM --- Path to the real streamer executable (edit if your build is elsewhere) ---
 if "%REAL_STREAMER_PATH%"=="" set "REAL_STREAMER_PATH=%~dp0..\target\debug\streamer.exe"

REM --- Where the proxy writes its IPC log ---
 if "%PROXY_LOG_FILE%"=="" set "PROXY_LOG_FILE=%~dp0ipc-proxy.log"

node "%~dp0claude_version.mjs" "%REAL_STREAMER_PATH%"

pause
