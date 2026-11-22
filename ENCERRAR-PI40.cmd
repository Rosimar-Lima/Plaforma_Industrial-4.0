@echo off
title Encerrar PI40 com seguranca
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\pi40-dia.ps1" -Action Stop
