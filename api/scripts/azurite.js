const { spawn, execFile } = require('node:child_process');
const path = require('node:path');
const http = require('node:http');

const TABLE_ENTRY = path.join(__dirname, '..', 'node_modules', 'azurite', 'dist', 'src', 'table', 'main.js');
const TABLE_PORT = 10002;
const STARTUP_TIMEOUT_MS = 20000;
const SHUTDOWN_TIMEOUT_MS = 5000;

function pingPort(port) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 1000 }, (res) => {
      res.resume();
      resolve();
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy());
  });
}

function findWindowsPidOnPort(port) {
  return new Promise((resolve) => {
    execFile('netstat', ['-ano'], (err, stdout) => {
      if (err || !stdout) return resolve(null);
      const line = stdout
        .split(/\r?\n/)
        .find((l) => l.includes(`127.0.0.1:${port}`) && l.includes('LISTENING'));
      if (!line) return resolve(null);
      const pid = Number(line.trim().split(/\s+/).pop());
      resolve(Number.isInteger(pid) ? pid : null);
    });
  });
}

function killWindowsPid(pid) {
  return new Promise((resolve) => {
    execFile('taskkill', ['/PID', String(pid), '/F'], () => resolve());
  });
}

// azurite-table às vezes deixa um processo filho ainda escutando na porta
// mesmo depois do processo que demos spawn() já ter emitido 'exit' (parece
// desacoplar a HTTP server de um worker interno) — então não basta esperar
// o 'exit' do child, tem que confirmar que a porta de fato fechou, e no
// Windows caçar/matar quem ainda estiver nela se não fechar sozinha.
async function ensurePortClosed(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await pingPort(port);
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  if (process.platform === 'win32') {
    const pid = await findWindowsPidOnPort(port);
    if (pid) await killWindowsPid(pid);
    return;
  }

  console.warn(`aviso: porta ${port} do azurite-table continua aberta após o shutdown`);
}

// Spawna node diretamente contra o entry point do azurite-table (em vez do
// wrapper .cmd/.bin) pra garantir que child.kill() derrube o processo de
// verdade — no Windows, matar um wrapper .cmd não mata o node.exe filho.
// Só sobe o serviço de tabelas (não blob/queue, que não são usados aqui) em
// memória (--inMemoryPersistence), sem deixar nada em disco pra limpar.
async function startAzuriteTable() {
  const child = spawn(
    process.execPath,
    [
      TABLE_ENTRY,
      '--silent',
      '--inMemoryPersistence',
      '--tablePort',
      String(TABLE_PORT),
      '--disableTelemetry',
    ],
    { stdio: 'ignore' }
  );

  let exitError = null;
  child.once('exit', (code) => {
    exitError = new Error(`azurite-table saiu cedo com código ${code}`);
  });

  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (exitError) throw exitError;
    try {
      await pingPort(TABLE_PORT);
      return {
        connectionString: 'UseDevelopmentStorage=true',
        async stop() {
          child.kill();
          await new Promise((resolve) => child.once('exit', resolve));
          await ensurePortClosed(TABLE_PORT, SHUTDOWN_TIMEOUT_MS);
        },
      };
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  child.kill();
  throw new Error(`azurite-table não respondeu na porta ${TABLE_PORT} a tempo`);
}

module.exports = { startAzuriteTable };
