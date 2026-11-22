'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const serviceDir = path.resolve(__dirname, '../service');
const configPath = path.join(serviceDir, 'PI40-Gateway.xml');
const installerPath = path.resolve(__dirname, '../scripts/install-service.ps1');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

test('configuração do WinSW aponta para o entrypoint do gateway', () => {
  const xml = read(configPath);

  assert.match(xml, /<id>PI40Gateway<\/id>/);
  assert.match(xml, /<executable>[^<]*node\.exe<\/executable>/i);
  assert.match(xml, /<arguments>[^<]*src[\\/]index\.js[^<]*<\/arguments>/);
  assert.match(xml, /<workingdirectory>[^<]*%BASE%[\\/]*\.\.[^<]*<\/workingdirectory>/);
});

test('serviço inicia com o Windows e reinicia após falha', () => {
  const xml = read(configPath);

  assert.match(xml, /<startmode>Automatic<\/startmode>/);
  assert.match(xml, /<delayedAutoStart\s*\/>/);
  assert.match(xml, /<onfailure action="restart" delay="10 sec"\/>/);
  assert.match(xml, /<logpath>[^<]*logs<\/logpath>/);
  assert.match(xml, /<log mode="roll-by-size">/);
});

test('configuração de produção do ADS está explícita no serviço', () => {
  const xml = read(configPath);
  const expected = {
    INDUSTRIAL_PROTOCOL: 'ads',
    BACKEND_URL: 'http://localhost:3000',
    GATEWAY_MACHINE_ID: 'machine-01',
    GATEWAY_POLL_MS: '1000',
    ADS_TARGET_AMS_NET_ID: '39.90.64.65.1.1',
    ADS_TARGET_PORT: '851',
    ADS_AUTO_RECONNECT: 'false',
  };

  for (const [name, value] of Object.entries(expected)) {
    assert.ok(
      xml.includes(`<env name="${name}" value="${value}"/>`),
      `variável ${name} ausente ou incorreta no serviço`
    );
  }
});

test('instalador exige administrador e fixa o hash do WinSW', () => {
  const installer = read(installerPath);

  assert.match(installer, /WindowsPrincipal/);
  assert.match(installer, /WindowsBuiltInRole/);
  assert.match(installer, /WinSW\.NET462\.exe_Release/);
  assert.match(installer, /WinSwSha256 = '[0-9a-f]{64}'/);
});
