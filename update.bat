@echo off
cd /d "%~dp0"
where git >nul 2>nul
if errorlevel 1 (
  echo Git is not installed or not in PATH.
  echo Install Git for Windows, then try again.
  pause
  exit /b 1
)
git pull --ff-only
pause
