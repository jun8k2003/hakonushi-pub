@echo off
chcp 65001 > nul
setlocal

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\copy_gas.ps1"
if errorlevel 1 (
  echo.
  echo Failed to copy GAS code to clipboard.
  if not "%~1"=="--no-pause" pause
  exit /b 1
)

echo.
echo GASエディタの「コード.gs」へそのまま Ctrl+V で貼り付けてください。
if not "%~1"=="--no-pause" pause
