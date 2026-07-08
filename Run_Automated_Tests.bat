@echo off
echo Starting Backend (Flask) in the background...
start "Fleet Backend" cmd /c "cd telematics_backend\backend && python app.py"

echo Waiting 3 seconds for backend to start...
timeout /t 3 /nobreak >nul

echo.
echo Running Playwright Automated QA Tests (Visual Mode)...
echo.
npx playwright test --headed

echo.
echo Done! You can close this window now.
pause
