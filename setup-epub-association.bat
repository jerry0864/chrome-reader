@echo off
setlocal
set "DIR=%~dp0"
if "%DIR:~-1%"=="\" set "DIR=%DIR:~0,-1%"

rem 鈹€鈹€ 鎵?Node.js 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
set "NODE=C:\Program Files\nodejs\node.exe"
if not exist "%NODE%" set "NODE=C:\Program Files (x86)\nodejs\node.exe"
if not exist "%NODE%" (
  for /f "delims=" %%i in ('where node 2^>nul') do set "NODE=%%i"
)
if not exist "%NODE%" (
  echo Node.js not found. Install: https://nodejs.org
  exit /b 1
)

rem 鈹€鈹€ 鐢熸垚闈欓粯 VBS 鍚姩鍣紙闅愯棌榛戣壊鍛戒护绐楀彛锛?鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
set "VBS=%DIR%\open-epub.vbs"
(
  echo Set ws = CreateObject^("WScript.Shell"^)
  echo ws.Run Chr^(34^) ^& "%NODE%" ^& Chr^(34^) ^& " " ^& Chr^(34^) ^& "%DIR%\epub-server.js" ^& Chr^(34^) ^& " " ^& Chr^(34^) ^& WScript.Arguments^(0^) ^& Chr^(34^), 0, False
) > "%VBS%"

rem 鈹€鈹€ 娉ㄥ唽 EpubReaderFile 鏂囦欢绫诲瀷 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
reg add "HKCU\Software\Classes\EpubReaderFile"                    /ve /d "EPUB 鐢靛瓙涔?  /f >nul
reg add "HKCU\Software\Classes\EpubReaderFile\DefaultIcon"        /ve /d "C:\Program Files\Google\Chrome\Application\chrome.exe,0" /f >nul
reg add "HKCU\Software\Classes\EpubReaderFile\shell\open\command" /ve /d "wscript \"%VBS%\" \"%%1\"" /f >nul
reg add "HKCU\Software\Classes\.epub"                             /ve /d "EpubReaderFile" /f >nul

rem 鈹€鈹€ 鍒犻櫎 UserChoice锛堟竻闄?Chrome 瀵?.epub 鐨勬帴绠★級 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.epub\UserChoice" /f >nul 2>&1

echo Done.
endlocal

