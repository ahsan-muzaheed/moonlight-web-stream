@echo off
REM ===========================================================================
REM  setup-node-proxy.bat
REM
REM  Run this from the ROOT of your cloned repo:
REM      C:\Users\e3ds\Desktop\moonlight-web-stream\
REM
REM  It builds the folder structure + config + deps needed to run the Node
REM  port that lives in node-streamer-proxy\.
REM
REM  It does NOT create the .js source files - you place those yourself.
REM  It will TELL you if any are missing.
REM ===========================================================================

setlocal EnableDelayedExpansion

REM -- Always work from the folder this .bat lives in ------------------------
cd /d "%~dp0"

echo.
echo ==========================================================
echo   moonlight-web-stream : Node proxy setup
echo   Repo root: %CD%
echo ==========================================================
echo.

REM -- Sanity check: are we actually at the repo root? -----------------------
if not exist "Cargo.toml" (
    echo [ERROR] Cargo.toml not found.
    echo         Put this .bat at the repo ROOT and run it there:
    echo         C:\Users\e3ds\Desktop\moonlight-web-stream\
    echo.
    pause
    exit /b 1
)
echo [OK] Repo root confirmed.

REM -- Check Node is installed -----------------------------------------------
where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js is not on your PATH. Install it from nodejs.org
    echo.
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node --version') do echo [OK] Node %%v

REM =========================================================================
REM  1. Folder structure
REM =========================================================================
echo.
echo --- Creating folder structure ---

set PROXY=node-streamer-proxy

if not exist "%PROXY%"                mkdir "%PROXY%"
if not exist "%PROXY%\src"            mkdir "%PROXY%\src"
if not exist "%PROXY%\src\moonlight"  mkdir "%PROXY%\src\moonlight"
if not exist "%PROXY%\src\routes"     mkdir "%PROXY%\src\routes"
if not exist "%PROXY%\static"         mkdir "%PROXY%\static"

echo [OK] %PROXY%\
echo [OK] %PROXY%\src\
echo [OK] %PROXY%\src\moonlight\
echo [OK] %PROXY%\src\routes\
echo [OK] %PROXY%\static\

REM =========================================================================
REM  2. package.json  (overwritten every run - safe, it has no user edits)
REM =========================================================================
echo.
echo --- Writing package.json ---

set PKG=%PROXY%\package.json
echo {                                                    > "%PKG%"
echo   "name": "moonlight-web-server-node",              >> "%PKG%"
echo   "version": "0.1.0",                               >> "%PKG%"
echo   "private": true,                                  >> "%PKG%"
echo   "main": "src/index.js",                           >> "%PKG%"
echo   "scripts": {                                      >> "%PKG%"
echo     "start": "node src/index.js"                    >> "%PKG%"
echo   },                                                >> "%PKG%"
echo   "dependencies": {                                 >> "%PKG%"
echo     "express": "^4.19.2",                           >> "%PKG%"
echo     "express-ws": "^5.0.2",                         >> "%PKG%"
echo     "ws": "^8.17.0",                                >> "%PKG%"
echo     "cookie-parser": "^1.4.6",                      >> "%PKG%"
echo     "node-forge": "^1.3.1",                         >> "%PKG%"
echo     "xml2js": "^0.6.2"                              >> "%PKG%"
echo   }                                                 >> "%PKG%"
echo }                                                   >> "%PKG%"

echo [OK] %PKG%

REM =========================================================================
REM  3. config.json  (NOT overwritten - you will edit this)
REM =========================================================================
echo.
echo --- Writing config.json ---

set CFG=%PROXY%\config.json

if exist "%CFG%" (
    echo [SKIP] %CFG% already exists, leaving your edits alone.
) else (
    echo {                                                              > "%CFG%"
    echo   "web_server": {                                             >> "%CFG%"
    echo     "address": "0.0.0.0",                                     >> "%CFG%"
    echo     "port": 8080,                                             >> "%CFG%"
    echo     "url_path_prefix": "/",                                   >> "%CFG%"
    echo     "forwarded_header": null,                                 >> "%CFG%"
    echo     "first_login_create_admin": true,                         >> "%CFG%"
    echo     "session_cookie_expiration_secs": 604800,                 >> "%CFG%"
    echo     "session_cookie_secure": false,                           >> "%CFG%"
    echo     "static_dir": "static"                                    >> "%CFG%"
    echo   },                                                          >> "%CFG%"
    echo   "moonlight": {                                              >> "%CFG%"
    echo     "default_http_port": 47989                                >> "%CFG%"
    echo   },                                                          >> "%CFG%"
    echo   "streamer": {                                               >> "%CFG%"
    echo     "path": "../target/release/streamer.exe",                 >> "%CFG%"
    echo     "log_level": "Debug"                                      >> "%CFG%"
    echo   },                                                          >> "%CFG%"
    echo   "webrtc": {                                                 >> "%CFG%"
    echo     "ice_servers": [                                          >> "%CFG%"
    echo       { "urls": ["stun:stun.l.google.com:19302"] }            >> "%CFG%"
    echo     ]                                                         >> "%CFG%"
    echo   },                                                          >> "%CFG%"
    echo   "storage": {                                                >> "%CFG%"
    echo     "path": "storage.json"                                    >> "%CFG%"
    echo   }                                                           >> "%CFG%"
    echo }                                                             >> "%CFG%"
    echo [OK] %CFG%
)

REM =========================================================================
REM  4. Verify the source files you placed
REM =========================================================================
echo.
echo --- Checking for your ported .js source files ---

set MISSING=0

call :checkfile "%PROXY%\src\index.js"
call :checkfile "%PROXY%\src\config.js"
call :checkfile "%PROXY%\src\password.js"
call :checkfile "%PROXY%\src\storage.js"
call :checkfile "%PROXY%\src\auth.js"
call :checkfile "%PROXY%\src\moonlight\crypto.js"
call :checkfile "%PROXY%\src\moonlight\client.js"
call :checkfile "%PROXY%\src\moonlight\wol.js"
call :checkfile "%PROXY%\src\routes\core.js"
call :checkfile "%PROXY%\src\routes\hosts.js"
call :checkfile "%PROXY%\src\routes\stream.js"

if !MISSING! GTR 0 (
    echo.
    echo [WARN] !MISSING! source file^(s^) missing. Copy them into the paths above,
    echo        then re-run this script. Continuing with npm install anyway...
)

REM =========================================================================
REM  5. npm install
REM =========================================================================
echo.
echo --- Installing npm dependencies ---
pushd "%PROXY%"
call npm install --no-audit --no-fund
if errorlevel 1 (
    echo [ERROR] npm install failed.
    popd
    pause
    exit /b 1
)
popd
echo [OK] Dependencies installed.

REM =========================================================================
REM  6. Frontend: copy the built web UI into static\
REM =========================================================================
echo.
echo --- Frontend ---

if exist "dist\index.html" (
    echo Copying dist\ into %PROXY%\static\ ...
    xcopy /E /I /Y /Q "dist\*" "%PROXY%\static\" >nul
    echo [OK] Frontend copied from dist\
) else if exist "static\index.html" (
    echo Copying static\ into %PROXY%\static\ ...
    xcopy /E /I /Y /Q "static\*" "%PROXY%\static\" >nul
    echo [OK] Frontend copied from static\
) else (
    echo [WARN] No built frontend found ^(no dist\index.html or static\index.html^).
    echo        Build the web UI first, e.g.:
    echo            cd web  ^&^&  npm install  ^&^&  npm run build
    echo        then re-run this script to copy it in.
)

REM =========================================================================
REM  7. Streamer binary
REM =========================================================================
echo.
echo --- Streamer binary ---

if exist "target\release\streamer.exe" (
    echo [OK] Found target\release\streamer.exe
) else (
    echo [WARN] target\release\streamer.exe not found.
    echo        Build it with:   cargo build --release
    echo        Or edit "streamer.path" in %CFG% to point at your binary.
)

REM =========================================================================
REM  Done
REM =========================================================================
echo.
echo ==========================================================
echo   Setup complete.
echo.
echo   To run:
echo       cd %PROXY%
echo       node src\index.js
echo.
echo   Then open:  http://localhost:8080
echo   First login creates the admin account.
echo.
echo   For streamer debug logs:
echo       set RUST_LOG=debug ^&^& node src\index.js
echo ==========================================================
echo.
pause
exit /b 0

REM =========================================================================
REM  :checkfile  - report presence of one source file
REM =========================================================================
:checkfile
if exist "%~1" (
    echo   [OK]      %~1
) else (
    echo   [MISSING] %~1
    set /a MISSING+=1
)
exit /b 0
