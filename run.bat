@echo off
setlocal enableextensions

REM ============================================================
REM  moonlight-web-stream  -  full build script
REM  Self-contained: sets its own environment every run, so it
REM  works in a fresh terminal with nothing pre-exported.
REM  Re-run this after any code change (frontend or Rust).
REM ============================================================

REM --- Project root (edit this if you move the repo) ---
set "PROJECT_ROOT=C:\Users\e3ds\Desktop\moonlight-web-stream"

REM --- Put the correct tool versions first on PATH ---
REM    (guards against an old CMake elsewhere shadowing 4.3.3)
set "PATH=C:\Program Files\CMake\bin;C:\clang-llvm\bin;%PATH%"

REM --- Build environment ---
set "OPENSSL_NO_VENDOR=1"
set "OPENSSL_DIR=C:/Program Files/OpenSSL-Win64"
set "OPENSSL_INCLUDE_DIR=C:/Program Files/OpenSSL-Win64/include"
set "OPENSSL_LIB_DIR=C:/Program Files/OpenSSL-Win64/lib/VC/x64/MD"
set "LIBCLANG_PATH=C:/clang-llvm/bin"
set "CMAKE_GENERATOR=Ninja"

REM --- Make absolutely sure static linking is OFF ---
set "OPENSSL_STATIC="

echo.
echo ============================================================
echo  Environment set. Starting build.
echo ============================================================

REM ---------- [1/2] Web frontend + bindings (run from src) ----------
echo.
echo === [1/2] npm install ^&^& npm run build  (in src) ===
cd /d "%PROJECT_ROOT%\src" || goto :error
call npm i
if errorlevel 1 goto :error
call npm run build
if errorlevel 1 goto :error

REM ---------- [2/2] Rust binaries (run from project root) ----------
echo.
echo === [2/2] cargo build --release --workspace  (in root) ===
cd /d "%PROJECT_ROOT%" || goto :error
call cargo build --release --workspace
if errorlevel 1 goto :error

echo.
echo ============================================================
echo  BUILD SUCCEEDED
echo ------------------------------------------------------------
echo  web-server.exe -^> %PROJECT_ROOT%\target\release\web-server.exe
echo  streamer.exe   -^> %PROJECT_ROOT%\target\release\streamer.exe
echo ============================================================
goto :end

:error
echo.
echo ************************************************************
echo  BUILD FAILED  (exit code %errorlevel%) - see output above
echo ************************************************************
endlocal
pause
exit /b 1

:end
endlocal
pause
