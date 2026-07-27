@echo off
setlocal EnableDelayedExpansion
REM ===========================================================================
REM  build-streamer.bat  -  compile streamer.exe (the Rust streamer subprocess)
REM
REM  Run from the repo root:
REM     C:\Users\e3ds\Desktop\moonlight-web-stream\
REM
REM  Unlike the toolchain-installer script, this one CAN do everything in one
REM  window: it uses `set` (not setx) to configure env vars for cargo, which
REM  DOES apply to child processes in the same session. So no new-terminal step.
REM
REM  Output: target\release\streamer.exe
REM ===========================================================================

cd /d "%~dp0"

echo.
echo ==========================================================
echo   Building streamer.exe
echo   Repo: %CD%
echo ==========================================================
echo.

REM ---- Must be at the repo root -------------------------------------------
if not exist "Cargo.toml"       goto no_root
if not exist "streamer\Cargo.toml" goto no_root
goto root_ok
:no_root
echo [ERROR] Run this from the repo ROOT (where Cargo.toml and streamer\ are).
goto end
:root_ok
echo [OK] Repo root confirmed.
echo.

REM ---- cargo present? -----------------------------------------------------
where cargo >nul 2>&1
if not %errorlevel%==0 goto no_cargo
for /f "delims=" %%v in ('cargo --version') do echo [OK] %%v
goto cargo_ok
:no_cargo
echo [ERROR] cargo not found on PATH. Install Rust (rustup) and open a new
echo         terminal, then re-run.
goto end
:cargo_ok
echo.

REM ---- LIBCLANG_PATH for bindgen (moonlight-common-sys) -------------------
REM  set (not setx) so it applies to the cargo child process in THIS window.
if defined LIBCLANG_PATH goto libclang_ok
if not exist "%ProgramFiles%\LLVM\bin\libclang.dll" goto no_libclang
set "LIBCLANG_PATH=%ProgramFiles%\LLVM\bin"
echo [OK] LIBCLANG_PATH set for this build: !LIBCLANG_PATH!
goto libclang_ok
:no_libclang
echo [ERROR] libclang.dll not found at %ProgramFiles%\LLVM\bin
echo         Install LLVM (winget install --id LLVM.LLVM -e) and make sure the
echo         DLL exists there, then re-run. bindgen needs it.
goto end
:libclang_ok
echo.

REM ---- Make sure the MSVC linker is reachable -----------------------------
REM  cargo needs link.exe from VS Build Tools. If it isn't on PATH, try to
REM  import the VS environment via vcvars64.bat.
where link.exe >nul 2>&1
if %errorlevel%==0 goto have_link
echo [..] MSVC link.exe not on PATH, trying to load VS build environment...
set "VSVARS=%ProgramFiles(x86)%\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
if exist "%VSVARS%" goto load_vsvars
set "VSVARS=%ProgramFiles%\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat"
if exist "%VSVARS%" goto load_vsvars
echo [WARN] Could not find vcvars64.bat. If the build fails with 'link.exe not
echo        found', open the "x64 Native Tools Command Prompt for VS 2022" and
echo        run this script from there instead.
goto link_done
:load_vsvars
echo [OK] Loading VS environment: %VSVARS%
call "%VSVARS%" >nul
goto link_done
:have_link
echo [OK] MSVC link.exe found.
:link_done
echo.

REM ---- Build --------------------------------------------------------------
echo ==========================================================
echo   Running: cargo build --release --package streamer
echo   (first build is slow: it compiles OpenSSL + moonlight-common-c)
echo ==========================================================
echo.
cargo build --release --package streamer
if not %errorlevel%==0 goto build_failed

REM ---- Verify + report the artifact --------------------------------------
set "EXE=%CD%\target\release\streamer.exe"
if not exist "%EXE%" goto no_exe
echo.
echo ==========================================================
echo   [SUCCESS] Built: %EXE%
for %%A in ("%EXE%") do echo   Size: %%~zA bytes   Modified: %%~tA
echo.
echo   Your config.json streamer.path should point here, e.g.:
echo       "path": "../target/release/streamer.exe"
echo   (relative to node-streamer-proxy\), or use the absolute path above.
echo ==========================================================
goto end

:no_exe
echo [ERROR] cargo reported success but %EXE% is missing. Check the output above.
goto end

:build_failed
echo.
echo ==========================================================
echo   [BUILD FAILED] cargo exited with an error (see output above).
echo.
echo   Common causes:
echo     - 'link.exe' not found  -> install VS Build Tools "Desktop
echo       development with C++", or run from the x64 Native Tools prompt.
echo     - libclang errors       -> LLVM/LIBCLANG_PATH problem.
echo     - a compile error in your own struct edits (url_origin/url_path/
echo       url_params) -> that's the good kind; paste it.
echo ==========================================================
goto end

:end
echo.
echo Press any key to close...
pause >nul
exit /b 0