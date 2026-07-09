@echo off
:: Axxam Launcher with Silent Printing
:: Ce script lance l'application avec l'impression automatique activée.

set "APP_URL=http://localhost:5173/index.html"

:: Chemins possibles pour Chrome
set "CHROME_1=C:\Program Files\Google\Chrome\Application\chrome.exe"
set "CHROME_2=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
set "CHROME_3=%LocalAppData%\Google\Chrome\Application\chrome.exe"

if exist "%CHROME_1%" (
    set "CHROME_EXE=%CHROME_1%"
) else if exist "%CHROME_2%" (
    set "CHROME_EXE=%CHROME_2%"
) else if exist "%CHROME_3%" (
    set "CHROME_EXE=%CHROME_3%"
) else (
    :: Si on ne trouve pas Chrome aux endroits habituels, on essaie de le lancer directement s'il est dans le PATH
    set "CHROME_EXE=chrome.exe"
)

where node >nul 2>&1
if errorlevel 1 (
    echo Node.js est requis pour lancer la base SQLite locale.
    pause
    exit /b 1
)

:: Lancer le serveur local SQLite
pushd "%~dp0"
start "Axxam SQLite" /min node --no-warnings "%~dp0server.js"
popd
timeout /t 2 /nobreak >nul

:: Lancer Chrome en mode application avec impression silencieuse
start "" "%CHROME_EXE%" --kiosk-printing --app="%APP_URL%"

exit
