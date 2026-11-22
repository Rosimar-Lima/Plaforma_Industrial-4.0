[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$backendUrl = 'http://localhost:3000'

$connection = $null
try {
    $connection = Invoke-RestMethod -UseBasicParsing -TimeoutSec 3 `
        "$backendUrl/api/machines/1/connection"
}
catch {
    # Sem backend não há leitura de heartbeat para autorizar o encerramento.
}

if ($null -eq $connection) {
    Write-Host 'Nao foi possivel consultar a linha: o backend nao responde.'
    Write-Host 'Inicie a PI40 ou use o dashboard para encerrar com seguranca.'
    exit 1
}

if ($connection.state -ne 'offline') {
    Write-Host "Encerramento bloqueado: a linha ainda responde (state=$($connection.state), running=$($connection.running))."
    Write-Host 'Desligue a linha fisicamente e execute ENCERRAR-PI40.cmd novamente.'
    exit 2
}

Write-Host 'Linha desligada confirmada. Encerrando a PI40...'
$script = Join-Path $root 'scripts\pi40-dia.ps1'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $script -Action Stop
exit $LASTEXITCODE
