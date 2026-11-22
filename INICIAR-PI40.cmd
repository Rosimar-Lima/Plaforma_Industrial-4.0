@echo off
title Iniciar PI40
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\pi40-dia.ps1" -Action Start
