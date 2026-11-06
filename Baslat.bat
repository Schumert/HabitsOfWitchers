@echo off
cd /d "%~dp0"
title Habits of Witchers
py -3 server.py %*
if errorlevel 1 pause
