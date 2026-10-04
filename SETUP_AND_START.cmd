@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

echo.
echo ================================
echo       Silah local setup
echo ================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed or not available in PATH.
  echo Install Node.js 20 or newer, then run this file again.
  pause
  exit /b 1
)

if not exist .env (
  echo Paste your Groq API key below. It will be saved only in local .env.
  echo The .env file is ignored by Git and should not be uploaded to GitHub.
  echo.
  set /p GROQKEY=Groq API key: 
  if not defined GROQKEY (
    echo No key entered. Setup stopped.
    pause
    exit /b 1
  )
  > .env echo GROQ_API_KEY=!GROQKEY!
  >> .env echo GROQ_MODEL=openai/gpt-oss-20b
  >> .env echo GROQ_TIMEOUT_MS=8500
  >> .env echo PORT=3000
  echo.
  echo Local .env created.
) else (
  echo Existing local .env found. It will be used as is.
)

echo.
echo Running project checks...
call npm run check
if errorlevel 1 (
  echo.
  echo Checks failed. Review the messages above before starting.
  pause
  exit /b 1
)

echo.
echo Starting Silah...
echo Open http://localhost:3000 after the server starts.
echo Press Ctrl+C to stop the server.
echo.
call npm start
