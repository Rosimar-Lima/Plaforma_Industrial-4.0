@echo off
title Encerrar PI40 com seguranca
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\encerrar-pi40.ps1"
