[CmdletBinding()]
param(
    [ValidateSet('Install', 'Uninstall', 'Start', 'Stop', 'Restart', 'Status')]
    [string]$Action = 'Install',

    # WinSW 2.13.0 (build .NET 4.6.2). O hash é o publicado no release oficial.
    [string]$WinSwVersion = 'v2.13.0',
    [string]$WinSwSha256 = 'e139f9c1dec5c87a0f51a01668b6cc819286c26b8d26c21c6a2ac128993496c6'
)

$ErrorActionPreference = 'Stop'

$gatewayDir = Split-Path -Parent $PSScriptRoot
$serviceDir = Join-Path $gatewayDir 'service'
$configPath = Join-Path $serviceDir 'PI40-Gateway.xml'
$exePath = Join-Path $serviceDir 'PI40-Gateway.exe'
$logsDir = Join-Path $serviceDir 'logs'
$serviceId = 'PI40Gateway'
$winSwAsset = "https://github.com/winsw/winsw/releases/download/$WinSwVersion/WinSW.NET462.exe_Release"

function Assert-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Execute o PowerShell como Administrador para gerenciar o serviço PI40Gateway.'
    }
}

function Assert-GatewayFiles {
    if (-not (Test-Path -LiteralPath $configPath)) {
        throw "Configuração não encontrada: $configPath"
    }

    [xml]$config = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8
    $nodeExe = $config.service.executable
    if (-not $nodeExe -or -not (Test-Path -LiteralPath $nodeExe)) {
        throw "Node.js não encontrado em '$nodeExe'. Ajuste <executable> em $configPath."
    }

    $entryPoint = Join-Path $gatewayDir 'src\index.js'
    if (-not (Test-Path -LiteralPath $entryPoint)) {
        throw "Entrypoint do gateway não encontrado: $entryPoint"
    }

    if (-not (Test-Path -LiteralPath (Join-Path $gatewayDir 'node_modules'))) {
        throw 'Dependências ausentes. Execute "npm install" dentro de gateway/ antes de instalar o serviço.'
    }
}

function Get-WinSwExecutable {
    if (Test-Path -LiteralPath $exePath) {
        $currentHash = (Get-FileHash -LiteralPath $exePath -Algorithm SHA256).Hash
        if ($currentHash -ieq $WinSwSha256) {
            return
        }
        Write-Warning "WinSW com hash diferente da versão fixada; substituindo $exePath."
        Remove-Item -LiteralPath $exePath -Force
    }

    Write-Host "Baixando WinSW $WinSwVersion..."
    $tempPath = Join-Path ([IO.Path]::GetTempPath()) "pi40-winsw-$([guid]::NewGuid()).exe"
    try {
        Invoke-WebRequest -Uri $winSwAsset -OutFile $tempPath -UseBasicParsing
        $downloadedHash = (Get-FileHash -LiteralPath $tempPath -Algorithm SHA256).Hash
        if ($downloadedHash -ine $WinSwSha256) {
            throw "Hash SHA-256 do WinSW não confere: $downloadedHash"
        }
        Move-Item -LiteralPath $tempPath -Destination $exePath -Force
    }
    finally {
        if (Test-Path -LiteralPath $tempPath) {
            Remove-Item -LiteralPath $tempPath -Force
        }
    }
}

function Invoke-WinSw {
    param([string[]]$WinSwArguments)

    & $exePath @WinSwArguments
    if ($LASTEXITCODE -ne 0) {
        throw "WinSW $($WinSwArguments -join ' ') falhou com código $LASTEXITCODE."
    }
}

function Stop-WinSwIgnoreErrors {
    & $exePath stop $configPath 2>&1 | Out-Null
}

switch ($Action) {
    'Install' {
        Assert-Administrator
        Assert-GatewayFiles
        Get-WinSwExecutable

        if (Get-Service -Name $serviceId -ErrorAction SilentlyContinue) {
            Write-Host "Removendo instalação anterior de $serviceId..."
            Stop-WinSwIgnoreErrors
            Invoke-WinSw @('uninstall', $configPath)
        }

        New-Item -ItemType Directory -Path $logsDir -Force | Out-Null
        Invoke-WinSw @('install', $configPath)
        Invoke-WinSw @('start', $configPath)

        $service = Get-Service -Name $serviceId
        Write-Host "Serviço $serviceId instalado: $($service.Status)."
        Write-Host "Logs: $logsDir"
    }
    'Uninstall' {
        Assert-Administrator
        if (-not (Test-Path -LiteralPath $exePath)) {
            throw "Wrapper não encontrado em $exePath; rode a ação Install uma vez."
        }
        if (Get-Service -Name $serviceId -ErrorAction SilentlyContinue) {
            Stop-WinSwIgnoreErrors
            Invoke-WinSw @('uninstall', $configPath)
            Write-Host "Serviço $serviceId removido."
        }
        else {
            Write-Host "Serviço $serviceId não estava instalado."
        }
    }
    { $_ -in 'Start', 'Stop', 'Restart' } {
        Assert-Administrator
        if (-not (Test-Path -LiteralPath $exePath)) {
            throw "Wrapper não encontrado em $exePath; rode a ação Install uma vez."
        }
        $winSwAction = $Action.ToLowerInvariant()
        Invoke-WinSw @($winSwAction, $configPath)
        $service = Get-Service -Name $serviceId -ErrorAction SilentlyContinue
        if ($service) {
            Write-Host "Serviço ${serviceId}: $($service.Status)."
        }
    }
    'Status' {
        $service = Get-Service -Name $serviceId -ErrorAction SilentlyContinue
        if ($service) {
            Write-Host "Serviço ${serviceId}: $($service.Status) ($($service.StartType))."
        }
        else {
            Write-Warning "Serviço $serviceId não está instalado neste host."
        }
    }
}
