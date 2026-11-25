@echo off
title PI40 - iniciar ou encerrar
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\pi40-toggle.ps1"
