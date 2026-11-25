[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$backendUrl = 'http://localhost:3000'
$startScript = Join-Path $root 'scripts\pi40-dia.ps1'
$stopScript = Join-Path $root 'scripts\encerrar-pi40.ps1'

function Test-BackendOnline {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 "$backendUrl/health"
        return $response.StatusCode -ge 200 -and $response.StatusCode -lt 300
    }
    catch {
        return $false
    }
}

function Test-DockerAvailable {
    $docker = (Get-Command docker -ErrorAction SilentlyContinue).Source
    if (-not $docker) {
        $fallback = 'C:\Program Files\Rancher Desktop\resources\resources\win32\bin\docker.exe'
        if (-not (Test-Path -LiteralPath $fallback)) { return $false }
        $docker = $fallback
    }

    & $docker info --format '{{.ServerVersion}}' 2>$null | Out-Null
    return $LASTEXITCODE -eq 0
}

function Invoke-PI40Script {
    param([string]$Script, [string[]]$Arguments = @())

    $allArguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $Script + '"')) + $Arguments
    $process = Start-Process -FilePath 'powershell.exe' -ArgumentList $allArguments -PassThru -Wait
    return $process.ExitCode
}

if (Test-BackendOnline) {
    Write-Host 'PI40 está no ar. Verificando se a linha pode ser encerrada...'
    $exitCode = Invoke-PI40Script -Script $stopScript
    exit $exitCode
}

Write-Host 'PI40 fora do ar. Preparando a inicialização...'
if (-not (Test-DockerAvailable)) {
    Write-Host 'Docker/Rancher Desktop não está disponível. Abra o Rancher Desktop e clique novamente.'
    exit 3
}

$exitCode = Invoke-PI40Script -Script $startScript -Arguments @('-Action', 'Start')
exit $exitCode
