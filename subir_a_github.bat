@echo off
chcp 65001 > nul
echo ========================================================
echo   Subiendo Sistema de Tickets CDM a GitHub...
echo ========================================================
echo.
set "PATH=%LOCALAPPDATA%\Programs\MinGit\cmd;%LOCALAPPDATA%\Programs\MinGit\mingw64\bin;%PATH%"

git push -u origin main

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ========================================================
    echo   [OK] !Proyecto subido exitosamente a GitHub!
    echo   Repositorio: https://github.com/LeoMen4/Sistema_TicketsCDM
    echo ========================================================
) else (
    echo.
    echo ========================================================
    echo   Si te solicito login, inicia sesion con tu cuenta GitHub.
    echo ========================================================
)
pause
