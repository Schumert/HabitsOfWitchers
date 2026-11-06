@echo off
cd /d "%~dp0"
title Habits of Witchers - TEST
echo Test modu: ayri bir test kaydi (hofw-test.db) kullanilir, gercek kaydina dokunulmaz.
echo Otomatik testler: http://localhost:8642/tests.html
py -3 server.py --open "?slot=test"
if errorlevel 1 pause
