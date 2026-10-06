@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Coletor PLD - SIN OS

rem Coletor do PLD oficial (CCEE Dados Abertos -> SIN OS). Duplo clique para rodar.
rem Precisa do Node 18+ (https://nodejs.org). Pede a chave na primeira vez e guarda em chave.txt
rem (nao compartilhe esse arquivo). Mantenha a janela aberta: coleta a cada 60 minutos.

where node >nul 2>nul
if not errorlevel 1 goto temnode
echo Node.js nao encontrado. Vou abrir a pagina de download: instale a versao LTS e rode este arquivo de novo.
start https://nodejs.org
pause
exit /b 1
:temnode

if exist coletor-ccee.mjs goto temscript
echo Coloque este arquivo na mesma pasta do coletor-ccee.mjs.
pause
exit /b 1
:temscript

rem as linhas abaixo ficam fora de blocos com parenteses de proposito: %CHAVE% so existe depois do set /p
if exist chave.txt goto temchave
echo Cole a PLD_INGEST_KEY (a mesma cadastrada na Vercel) e tecle Enter:
set /p CHAVE=
>chave.txt echo %CHAVE%
:temchave
set /p PLD_INGEST_KEY=<chave.txt
if not "%PLD_INGEST_KEY%"=="" goto temvalor
echo chave.txt esta vazio. Apague o arquivo e rode de novo.
pause
exit /b 1
:temvalor
if "%SIN_OS_URL%"=="" set SIN_OS_URL=https://sinos-iota.vercel.app

rem Plano B: se voce baixou o CSV do portal, salve nesta pasta como pld.csv e ele envia esse arquivo.
if not exist pld.csv goto coleta
echo Enviando pld.csv ...
node coletor-ccee.mjs --csv pld.csv
pause
exit /b

:coleta
node coletor-ccee.mjs --loop 60
pause
