[CmdletBinding()]
param(
    [ValidateSet('Start', 'Stop', 'Status')]
    [string]$Action = 'Status'
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$statusPath = Join-Path $root 'dashboard\frontend\system-status.json'
$installerPath = Join-Path $root 'gateway\scripts\install-service.ps1'
$serviceId = 'PI40Gateway'
$backendUrl = 'http://localhost:3000'

$script:status = [ordered]@{
    state     = 'idle'
    action    = $null
    steps     = @()
    message   = ''
    updatedAt = $null
}

function Test-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Ensure-Administrator {
    if (Test-Administrator) { return }

    # Os atalhos .cmd chamam este script sem elevação; o UAC aparece aqui.
    Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList @(
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', ('"' + $PSCommandPath + '"'),
        '-Action', $Action
    )
    exit 0
}

function Write-Status {
    param(
        [string]$State = $script:status.state,
        [string]$Message = $script:status.message
    )

    $script:status.state = $State
    $script:status.message = $Message
    $script:status.updatedAt = (Get-Date).ToUniversalTime().ToString('o')
    $json = $script:status | ConvertTo-Json -Depth 6
    [IO.File]::WriteAllText($statusPath, $json, (New-Object System.Text.UTF8Encoding($false)))
}

function Initialize-Steps {
    param([string[]]$Definitions)

    $script:status.action = $Action
    $script:status.steps = @($Definitions | ForEach-Object {
        $parts = $_ -split '\|', 3
        [ordered]@{ id = $parts[0]; label = $parts[1]; status = 'pending'; detail = $parts[2] }
    })
    Write-Status -State 'running' -Message 'Operação iniciada.'
}

function Set-Step {
    param(
        [string]$Id,
        [string]$Status,
        [string]$Detail
    )

    $step = $script:status.steps | Where-Object { $_.id -eq $Id } | Select-Object -First 1
    if ($step) {
        $step.status = $Status
        $step.detail = $Detail
    }
    Write-Status
}

function Get-DockerCommand {
    $command = Get-Command docker -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }

    $fallback = 'C:\Program Files\Rancher Desktop\resources\resources\win32\bin\docker.exe'
    if (Test-Path -LiteralPath $fallback) { return $fallback }
    throw 'Docker CLI não encontrado. Abra o Rancher Desktop ou ajuste o PATH.'
}

function Invoke-Docker {
    param([string[]]$DockerArguments)

    $docker = Get-DockerCommand
    Push-Location $root
    try {
        & $docker @DockerArguments
        if ($LASTEXITCODE -ne 0) {
            throw "docker $($DockerArguments -join ' ') falhou com código $LASTEXITCODE."
        }
    }
    finally {
        Pop-Location
    }
}

function Test-HttpOk {
    param([string]$Url, [int]$TimeoutSec = 3)

    try {
        $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec $TimeoutSec $Url
        return $response.StatusCode -ge 200 -and $response.StatusCode -lt 300
    }
    catch {
        return $false
    }
}

function Wait-ForUrl {
    param([string]$Url, [int]$Attempts = 40, [int]$DelaySeconds = 2)

    for ($i = 0; $i -lt $Attempts; $i++) {
        if (Test-HttpOk $Url) { return $true }
        Start-Sleep -Seconds $DelaySeconds
    }
    return $false
}

function Invoke-ServiceAction {
    param([string]$ServiceAction)

    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installerPath -Action $ServiceAction
    if ($LASTEXITCODE -ne 0) {
        throw "install-service.ps1 -Action $ServiceAction falhou com código $LASTEXITCODE."
    }
}

function Wait-ServiceState {
    param([string]$Desired, [int]$Attempts = 20)

    for ($i = 0; $i -lt $Attempts; $i++) {
        $service = Get-Service -Name $serviceId -ErrorAction SilentlyContinue
        if ($service -and $service.Status -eq $Desired) { return $true }
        Start-Sleep -Seconds 1
    }
    return $false
}

switch ($Action) {
    'Status' {
        if (Test-Path -LiteralPath $statusPath) {
            Get-Content -LiteralPath $statusPath -Raw -Encoding UTF8
        }
        else {
            '{ "state": "idle", "steps": [], "message": "Nenhuma operação de sistema em andamento." }'
        }
    }

    'Stop' {
        Ensure-Administrator
        Initialize-Steps @(
            'dashboard|Pausar dashboard e stream|Ao detectar esta ação, o painel encerra o monitoramento e fecha o SSE.',
            'gateway|Parar serviço PI40Gateway|Interrompe a leitura ADS; nenhum comando é escrito no CLP.',
            'persistence|Confirmar últimos dados no banco|Conta as amostras já persistidas no PostgreSQL.',
            'containers|Parar backend e PostgreSQL|Usa docker compose stop; o volume do banco não é removido.',
            'safe|Ambiente seguro|Ao concluir, é seguro desligar o computador.'
        )

        $current = 'dashboard'
        try {
            Set-Step $current 'done' 'Dashboard pausado; a linha física continua em operação, se estiver ligada.'

            $current = 'gateway'
            Set-Step $current 'active' 'Parando o serviço PI40Gateway...'
            Invoke-ServiceAction -ServiceAction 'Stop'
            if (-not (Wait-ServiceState -Desired 'Stopped')) {
                throw "O serviço $serviceId não parou no tempo esperado."
            }
            Set-Step $current 'done' 'Serviço PI40Gateway parado.'

            $current = 'persistence'
            Set-Step $current 'active' 'Consultando o banco...'
            Start-Sleep -Seconds 2
            $samples = ((Invoke-Docker -DockerArguments @(
                'compose', 'exec', '-T', 'postgres', 'psql',
                '-U', 'industrial', '-d', 'industrial', '-tAc',
                'SELECT count(*) FROM telemetry;'
            )) | Out-String).Trim()
            Set-Step $current 'done' "$samples amostras persistidas no PostgreSQL."

            $current = 'containers'
            Set-Step $current 'active' 'Parando backend e PostgreSQL...'
            Invoke-Docker -DockerArguments @('compose', 'stop', 'backend', 'postgres')
            $running = (& (Get-DockerCommand) compose ps --status running --services).Trim()
            if ($running) {
                throw "Containers ainda ativos: $running"
            }
            Set-Step $current 'done' 'Backend e PostgreSQL parados; volume preservado.'

            $current = 'safe'
            Set-Step $current 'done' 'É seguro desligar o computador. Não use docker compose down -v.'
            Write-Status -State 'done' -Message 'Encerramento seguro concluído.'
            Write-Host 'PI40 encerrada com segurança. É seguro desligar o computador.'
        }
        catch {
            Set-Step $current 'error' $_.Exception.Message
            Write-Status -State 'error' -Message $_.Exception.Message
            throw
        }
    }

    'Start' {
        Ensure-Administrator
        Initialize-Steps @(
            'containers|Iniciar backend e PostgreSQL|Sobe os containers do Compose; o simulador permanece parado.',
            'health|Aguardar API|GET /health do backend.',
            'gateway|Iniciar serviço PI40Gateway|Retoma a leitura ADS do host.',
            'line|Aguardar leitura da linha|Heartbeat e telemetria de Linha-01.',
            'ready|Plataforma pronta|Ao concluir, o dashboard pode ser aberto.'
        )

        $current = 'containers'
        try {
            Set-Step $current 'active' 'Subindo backend e PostgreSQL...'
            Invoke-Docker -DockerArguments @('compose', 'up', '-d', 'backend', 'postgres')
            Set-Step $current 'done' 'Containers em execução.'

            $current = 'health'
            Set-Step $current 'active' 'Aguardando /health...'
            if (-not (Wait-ForUrl -Url "$backendUrl/health")) {
                throw 'A API não respondeu /health no tempo esperado.'
            }
            Set-Step $current 'done' 'Backend respondeu com sucesso.'

            $current = 'gateway'
            Set-Step $current 'active' 'Iniciando o serviço PI40Gateway...'
            Invoke-ServiceAction -ServiceAction 'Start'
            if (-not (Wait-ServiceState -Desired 'Running')) {
                throw "O serviço $serviceId não iniciou no tempo esperado."
            }
            Set-Step $current 'done' 'Serviço PI40Gateway em execução.'

            $current = 'line'
            Set-Step $current 'active' 'Aguardando heartbeat e telemetria...'
            $online = $false
            for ($i = 0; $i -lt 45; $i++) {
                try {
                    $connection = Invoke-RestMethod -UseBasicParsing -TimeoutSec 3 "$backendUrl/api/machines/1/connection"
                    if ($connection.state -eq 'online') { $online = $true; break }
                }
                catch { }
                Start-Sleep -Seconds 2
            }
            if ($online) {
                Set-Step $current 'done' 'Gateway e CLP respondendo; telemetria em andamento.'
            }
            else {
                Set-Step $current 'error' 'Sem comunicação com a linha. Verifique se o PLC está conectado no TwinCAT XAE e se o runtime está em Run.'
            }

            $current = 'ready'
            if ($online) {
                Set-Step $current 'done' 'Abra http://localhost:3000/ para acompanhar a PI40.'
                Write-Status -State 'done' -Message 'PI40 pronta para uso.'
            }
            else {
                Set-Step $current 'done' 'Plataforma no ar, mas sem leitura do CLP.'
                Write-Status -State 'error' -Message 'PI40 no ar; a linha ainda não está respondendo.'
            }

            Start-Process 'http://localhost:3000/'
            Write-Host 'PI40 iniciada. Abra http://localhost:3000/'
        }
        catch {
            Set-Step $current 'error' $_.Exception.Message
            Write-Status -State 'error' -Message $_.Exception.Message
            throw
        }
    }
}
