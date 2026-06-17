@echo off
setlocal enabledelayedexpansion

REM ============================================================
REM  moonlight-web-stream : clone + VS Code debug setup (Windows/MSVC)
REM  Usage:  setup-debug-clone.bat [target-dir] [branch]

REM What the script does
REM Run it and it reproduces the exact setup we just did, in a fresh clone:

REM Checks prerequisites — git and cargo on PATH.
REM Auto-detects OpenSSL — uses C:\Program Files\OpenSSL-Win64 (warns if the dev install is missing).
REM Auto-detects libclang — uses vswhere to find your VS install, falls back to the VS 2022 Community path, then to C:\Program Files\LLVM.
REM Clones the repo (ahsan-muzaheed/moonlight-web-stream, branch ahsan2-vs-code-debug1).
REM Writes .vscode\launch.json, tasks.json, settings.json, extensions.json with the detected paths baked in.
REM Installs the rust-analyzer + C/C++ extensions (via code CLI).
REM Builds web-server with the right env vars to confirm it compiles, then opens VS Code on the folder.
REM Usage

REM setup-debug-clone.bat
REM Optional arguments — target directory and branch:


REM setup-debug-clone.bat my-folder master
REM After it finishes, open src\main.rs, set a breakpoint, press F5, and pick "Debug web-server (cppvsdbg)".

REM A couple of notes:

REM It auto-detects paths, so it'll adapt to VS Professional/Enterprise/BuildTools or a different VS year — but if OpenSSL or libclang live somewhere unusual, edit OPENSSL_ROOT near the top or install the missing piece (the script prints a clear error pointing at which).
REM Since this .bat lives in the repo, it'll also be in the clone — handy, but the clone it creates is a separate working copy with its own target\ (first build recompiles all crates, ~1 min).

REM ============================================================

set "REPO_URL=https://github.com/ahsan-muzaheed/moonlight-web-stream.git"

set "TARGET_DIR=%~1"
if "%TARGET_DIR%"=="" set "TARGET_DIR=moonlight-web-stream-debug"

set "BRANCH=%~2"
if "%BRANCH%"=="" set "BRANCH=ahsan2-vs-code-debug1"

echo ============================================================
echo  Repo   : %REPO_URL%
echo  Branch : %BRANCH%
echo  Target : %TARGET_DIR%
echo ============================================================
echo.

REM ---------- 1. Prerequisites ----------
where git >nul 2>&1   || (echo [ERROR] git not found in PATH & exit /b 1)
where cargo >nul 2>&1 || (echo [ERROR] cargo/rustup not found in PATH & exit /b 1)

REM ---------- 2. Detect system OpenSSL ----------
set "OPENSSL_ROOT=C:\Program Files\OpenSSL-Win64"
if not exist "%OPENSSL_ROOT%\include\openssl\ssl.h" (
  echo [WARN] System OpenSSL dev install not found at %OPENSSL_ROOT%
  echo        Install "Win64 OpenSSL" ^(full, not Light^) or edit OPENSSL_ROOT in this script.
)
set "OPENSSL_LIB=%OPENSSL_ROOT%\lib\VC\x64\MD"
set "OPENSSL_INC=%OPENSSL_ROOT%\include"

REM ---------- 3. Detect libclang (for bindgen) ----------
set "LIBCLANG="
set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
if exist "%VSWHERE%" (
  for /f "usebackq tokens=*" %%i in (`"%VSWHERE%" -latest -property installationPath`) do set "VSINSTALL=%%i"
)
if defined VSINSTALL if exist "!VSINSTALL!\VC\Tools\Llvm\x64\bin\libclang.dll" set "LIBCLANG=!VSINSTALL!\VC\Tools\Llvm\x64\bin"
if not defined LIBCLANG if exist "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Tools\Llvm\x64\bin\libclang.dll" set "LIBCLANG=C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Tools\Llvm\x64\bin"
if not defined LIBCLANG if exist "C:\Program Files\LLVM\bin\libclang.dll" set "LIBCLANG=C:\Program Files\LLVM\bin"
if not defined LIBCLANG (
  echo [ERROR] libclang.dll not found.
  echo         Install LLVM, or VS with the "C++ Clang tools for Windows" component.
  exit /b 1
)
echo [INFO] OpenSSL : %OPENSSL_ROOT%
echo [INFO] libclang: %LIBCLANG%
echo.

REM ---------- 4. Clone ----------
if exist "%TARGET_DIR%\.git" (
  echo [INFO] %TARGET_DIR% already a git repo, skipping clone.
) else (
  git clone --branch %BRANCH% %REPO_URL% "%TARGET_DIR%" || (echo [ERROR] git clone failed & exit /b 1)
)
cd /d "%TARGET_DIR%" || (echo [ERROR] cannot enter %TARGET_DIR% & exit /b 1)

REM ---------- 5. Write .vscode config ----------
REM JSON needs forward slashes (avoids backslash escaping)
set "OPENSSL_LIB_J=%OPENSSL_LIB:\=/%"
set "OPENSSL_INC_J=%OPENSSL_INC:\=/%"
set "LIBCLANG_J=%LIBCLANG:\=/%"

if not exist ".vscode" mkdir ".vscode"

REM ----- launch.json -----
set "F=.vscode\launch.json"
>"%F%"  echo {
>>"%F%" echo   "version": "0.2.0",
>>"%F%" echo   "configurations": [
>>"%F%" echo     {
>>"%F%" echo       "name": "Debug web-server (cppvsdbg)",
>>"%F%" echo       "type": "cppvsdbg",
>>"%F%" echo       "request": "launch",
>>"%F%" echo       "program": "${workspaceFolder}/target/debug/web-server.exe",
>>"%F%" echo       "args": [],
>>"%F%" echo       "cwd": "${workspaceFolder}",
>>"%F%" echo       "stopAtEntry": false,
>>"%F%" echo       "console": "integratedTerminal",
>>"%F%" echo       "environment": [
>>"%F%" echo         { "name": "RUST_BACKTRACE", "value": "1" }
>>"%F%" echo       ],
>>"%F%" echo       "preLaunchTask": "cargo build (web-server, debug)"
>>"%F%" echo     }
>>"%F%" echo   ]
>>"%F%" echo }

REM ----- tasks.json -----
set "F=.vscode\tasks.json"
>"%F%"  echo {
>>"%F%" echo   "version": "2.0.0",
>>"%F%" echo   "tasks": [
>>"%F%" echo     {
>>"%F%" echo       "label": "cargo build (web-server, debug)",
>>"%F%" echo       "type": "shell",
>>"%F%" echo       "command": "cargo",
>>"%F%" echo       "args": ["build", "--bin", "web-server"],
>>"%F%" echo       "group": "build",
>>"%F%" echo       "options": {
>>"%F%" echo         "env": {
>>"%F%" echo           "OPENSSL_NO_VENDOR": "1",
>>"%F%" echo           "OPENSSL_STATIC": "1",
>>"%F%" echo           "OPENSSL_LIB_DIR": "!OPENSSL_LIB_J!",
>>"%F%" echo           "OPENSSL_INCLUDE_DIR": "!OPENSSL_INC_J!",
>>"%F%" echo           "LIBCLANG_PATH": "!LIBCLANG_J!"
>>"%F%" echo         }
>>"%F%" echo       },
>>"%F%" echo       "problemMatcher": ["$rustc"]
>>"%F%" echo     }
>>"%F%" echo   ]
>>"%F%" echo }

REM ----- settings.json -----
set "F=.vscode\settings.json"
>"%F%"  echo {
>>"%F%" echo   "rust-analyzer.cargo.extraEnv": {
>>"%F%" echo     "OPENSSL_NO_VENDOR": "1",
>>"%F%" echo     "OPENSSL_STATIC": "1",
>>"%F%" echo     "OPENSSL_LIB_DIR": "!OPENSSL_LIB_J!",
>>"%F%" echo     "OPENSSL_INCLUDE_DIR": "!OPENSSL_INC_J!",
>>"%F%" echo     "LIBCLANG_PATH": "!LIBCLANG_J!"
>>"%F%" echo   }
>>"%F%" echo }

REM ----- extensions.json -----
set "F=.vscode\extensions.json"
>"%F%"  echo {
>>"%F%" echo   "recommendations": [
>>"%F%" echo     "rust-lang.rust-analyzer",
>>"%F%" echo     "ms-vscode.cpptools"
>>"%F%" echo   ]
>>"%F%" echo }

echo [INFO] Wrote .vscode\launch.json, tasks.json, settings.json, extensions.json
echo.

REM ---------- 6. Install VS Code extensions ----------
where code >nul 2>&1
if %errorlevel%==0 (
  echo [INFO] Installing VS Code extensions...
  call code --install-extension rust-lang.rust-analyzer
  call code --install-extension ms-vscode.cpptools
) else (
  echo [WARN] 'code' CLI not found; install rust-analyzer + C/C++ extensions manually.
)
echo.

REM ---------- 7. Initial debug build ----------
echo [INFO] Building web-server (debug)...
set "OPENSSL_NO_VENDOR=1"
set "OPENSSL_STATIC=1"
set "OPENSSL_LIB_DIR=%OPENSSL_LIB%"
set "OPENSSL_INCLUDE_DIR=%OPENSSL_INC%"
set "LIBCLANG_PATH=%LIBCLANG%"
cargo build --bin web-server
if errorlevel 1 (
  echo [ERROR] Build failed. Check the OpenSSL/libclang paths above.
  exit /b 1
)

echo.
echo ============================================================
echo  Done. To debug:
echo    1. code "%CD%"
echo    2. Open src\main.rs, set a breakpoint, press F5
echo       (pick "Debug web-server (cppvsdbg)")
echo ============================================================

REM Optionally open VS Code now:
where code >nul 2>&1 && start "" code "%CD%"

endlocal
