@echo off
setlocal EnableDelayedExpansion
REM ===========================================================================
REM  setup-build-env.bat  - installs the native toolchain the Rust build needs
REM  (Perl, NASM, LLVM/clang, CMake, Rust, Node, VS Build Tools C++).
REM
REM  Rewritten to AVOID parenthesized if/else blocks: cmd.exe mis-parses the
REM  literal parentheses in %ProgramFiles(x86)% when it sits inside an
REM  if(...) block, which caused "Command was unexpected at this time."
REM  We use GOTO labels instead - no paren nesting, no parser traps.
REM
REM  This window never closes on its own; it pauses at the end.
REM  Run from a NORMAL (non-elevated) Command Prompt.
REM ===========================================================================

echo.
echo ==========================================================
echo   Rust native build environment setup
echo ==========================================================
echo.

REM ---- Elevation check (net session succeeds only when elevated) -----------
net session >nul 2>&1
if not %errorlevel%==0 goto not_elevated
echo ==========================================================
echo   [WARNING] THIS WINDOW IS RUNNING AS ADMINISTRATOR
echo ==========================================================
echo   winget is a per-user alias and often is not found when elevated.
echo   Better: close this, open a NORMAL Command Prompt, run again.
echo   Installers will prompt for admin via UAC when they need it.
echo.
choice /c YN /m "Continue anyway in Administrator mode"
if errorlevel 2 goto user_abort
echo Continuing in Administrator mode...
goto after_elev
:not_elevated
echo [OK] Running in NORMAL (non-Administrator) mode - correct.
:after_elev
echo.

REM ---- Locate winget -------------------------------------------------------
set "WINGET="
where winget >nul 2>&1
if %errorlevel%==0 set "WINGET=winget"
if defined WINGET echo [OK] winget found on PATH.& goto have_winget

echo [..] winget not on PATH, searching WindowsApps package...
for /f "delims=" %%p in ('dir /b /s "%ProgramFiles%\WindowsApps\winget.exe" 2^>nul') do set "WINGET=%%p"
if defined WINGET echo [OK] Found winget at: !WINGET!& goto have_winget

if exist "%LOCALAPPDATA%\Microsoft\WindowsApps\winget.exe" set "WINGET=%LOCALAPPDATA%\Microsoft\WindowsApps\winget.exe"
if defined WINGET echo [OK] Found winget in user alias folder.& goto have_winget

echo [WARN] winget not found - using direct downloads.
set "USE_DIRECT=1"
:have_winget
echo.

REM ---- Install each tool ---------------------------------------------------
call :need "Strawberry Perl" "perl"  "StrawberryPerl.StrawberryPerl" "https://strawberryperl.com/download/5.38.2.2/strawberry-perl-5.38.2.2-64bit.msi" "msi"
call :need "NASM"            "nasm"  "NASM.NASM"                     "https://www.nasm.us/pub/nasm/releasebuilds/2.16.01/win64/nasm-2.16.01-installer-x64.exe" "exe"
call :need "LLVM / Clang"    "clang" "LLVM.LLVM"                     "https://github.com/llvm/llvm-project/releases/download/llvmorg-18.1.8/LLVM-18.1.8-win64.exe" "exe"
call :need "CMake"           "cmake" "Kitware.CMake"                 "https://github.com/Kitware/CMake/releases/download/v3.29.3/cmake-3.29.3-windows-x86_64.msi" "msi"
call :need "Rust (rustup)"   "cargo" "Rustlang.Rustup"               "https://static.rust-lang.org/rustup/dist/x86_64-pc-windows-msvc/rustup-init.exe" "exe"
call :need "Node.js LTS"     "node"  "OpenJS.NodeJS.LTS"             "https://nodejs.org/dist/v20.15.0/node-v20.15.0-x64.msi" "msi"

REM ---- VS Build Tools (C++) ------------------------------------------------
echo --- Visual Studio Build Tools (C++ workload) ---
set "VCDIR=%ProgramFiles(x86)%\Microsoft Visual Studio\2022\BuildTools\VC"
if exist "%VCDIR%" echo [OK] VS Build Tools with VC already present.& goto vs_done
echo Installing VS Build Tools with the C++ workload (large download)...
if defined USE_DIRECT goto vs_direct
"%WINGET%" install --id Microsoft.VisualStudio.2022.BuildTools -e --accept-source-agreements --accept-package-agreements --override "--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
if errorlevel 1 echo [WARN] winget VS install failed - trying direct...& goto vs_direct
echo [OK] VS Build Tools installed.& goto vs_done
:vs_direct
powershell -NoProfile -Command "try{Invoke-WebRequest -Uri 'https://aka.ms/vs/17/release/vs_BuildTools.exe' -OutFile \"$env:TEMP\vs_BuildTools.exe\" -UseBasicParsing}catch{exit 1}"
if not exist "%TEMP%\vs_BuildTools.exe" echo [WARN] Could not download VS Build Tools. Get it from visualstudio.microsoft.com and tick "Desktop development with C++".& goto vs_done
"%TEMP%\vs_BuildTools.exe" --quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended
echo [OK] VS Build Tools installer ran.
:vs_done
echo.

REM ---- LIBCLANG_PATH -------------------------------------------------------
echo --- LIBCLANG_PATH (needed by bindgen) ---
if not exist "%ProgramFiles%\LLVM\bin\libclang.dll" goto libclang_missing
setx LIBCLANG_PATH "%ProgramFiles%\LLVM\bin" >nul
echo [OK] LIBCLANG_PATH set to %ProgramFiles%\LLVM\bin
goto libclang_done
:libclang_missing
echo [WARN] libclang.dll not on disk yet at %ProgramFiles%\LLVM\bin
echo        If LLVM was just installed, RUN THIS SCRIPT AGAIN - the second
echo        pass skips everything else and just sets the variable.
:libclang_done
echo.

REM ---- Results -------------------------------------------------------------
echo ==========================================================
echo   RESULTS (this window still has the OLD PATH, so tools
echo   installed just now may show MISSING - that is expected).
echo ==========================================================
call :check perl
call :check nasm
call :check clang
call :check cmake
call :check cargo
call :check node
echo.
echo   LIBCLANG_PATH = %LIBCLANG_PATH%
echo.
echo ==========================================================
echo   NEXT: close this, open a NEW terminal, then:
echo     perl --version ^&^& clang --version ^&^& cmake --version
echo     cd C:\Users\e3ds\Desktop\moonlight-web-stream
echo     npm run build
echo ==========================================================
echo.
echo Press any key to close...
pause >nul
exit /b 0

:user_abort
echo Exiting. Re-run from a normal, non-elevated Command Prompt.
echo Press any key to close...
pause >nul
exit /b 0

REM ===========================================================================
REM  :need  "Display" "probe" "Winget.Id" "DirectUrl" "msi|exe"
REM ===========================================================================
:need
echo --- %~1 ---
where %~2 >nul 2>&1
if %errorlevel%==0 echo [OK] %~1 already available.& echo.& exit /b 0
if defined USE_DIRECT goto need_direct
echo Installing %~1 via winget...
"%WINGET%" install --id %~3 -e --accept-source-agreements --accept-package-agreements
if errorlevel 1 echo [WARN] winget failed for %~1 - trying direct...& goto need_direct
echo [OK] %~1 installed.& echo.& exit /b 0
:need_direct
echo Downloading %~1 installer...
set "OUT=%TEMP%\setup_%~2.%~5"
powershell -NoProfile -Command "try{Invoke-WebRequest -Uri '%~4' -OutFile '%OUT%' -UseBasicParsing}catch{exit 1}"
if not exist "%OUT%" echo [WARN] Could not download %~1. Install manually: %~4 & echo.& exit /b 0
echo Running %~1 installer...
if /i "%~5"=="msi" goto need_msi
"%OUT%" /S
goto need_done
:need_msi
msiexec /i "%OUT%" /qn /norestart
:need_done
echo [OK] %~1 installer finished (may need a new terminal to appear on PATH).
echo.
exit /b 0

REM ===========================================================================
REM  :check  probe
REM ===========================================================================
:check
where %~1 >nul 2>&1
if %errorlevel%==0 echo   [FOUND]   %~1& exit /b 0
echo   [MISSING] %~1   (may appear after opening a new terminal)
exit /b 0