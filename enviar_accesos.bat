@echo off
chcp 65001 > nul
echo ========================================================
echo   MESA DE AYUDA CDM - ENVÍO DE CREDENCIALES
echo ========================================================
echo.
echo Se enviará el correo formal con credenciales a los 43 usuarios.
echo.
set /p CONFIRMAR="¿Deseas iniciar el envío a TODOS los usuarios ahora mismo? (S/N): "
if /i "%CONFIRMAR%"=="S" (
    node enviar_accesos.js --enviar-todos
) else (
    echo.
    echo Envío cancelado.
)
pause

