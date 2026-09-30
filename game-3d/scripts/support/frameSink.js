// Recebe frames JPEG (data URL) da câmera espectadora e monta um .mp4 via
// ffmpeg (pipe stdin, um processo só, sem arquivo intermediário por frame).
// Se ffmpeg não estiver no PATH, cai de volta pra salvar cada frame como
// .jpg solto em `frameDir` — ainda satisfaz "captura frame a frame", só sem
// o passo de montagem automática (o comentário de aviso já diz como montar
// manualmente depois).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export async function createFrameSink({ outPath, frameDir, fps = 60 }) {
  const ffmpeg = spawn(
    'ffmpeg',
    ['-y', '-f', 'image2pipe', '-r', String(fps), '-i', '-', '-pix_fmt', 'yuv420p', outPath],
    { stdio: ['pipe', 'ignore', 'pipe'] }
  );

  const spawnedOk = await new Promise((resolve) => {
    ffmpeg.once('error', () => resolve(false));
    // Dá uma volta do event loop pro 'error' (ENOENT) ter chance de disparar
    // antes de decidirmos que o spawn deu certo.
    setImmediate(() => resolve(true));
  });

  if (!spawnedOk) {
    fs.mkdirSync(frameDir, { recursive: true });
    console.warn(
      `[record-demo] ffmpeg não encontrado no PATH — salvando frames soltos em ${frameDir}.\n` +
        `  Pra montar o vídeo depois: ffmpeg -f image2pipe -r ${fps} -i "${frameDir}/%06d.jpg" -pix_fmt yuv420p ${outPath}`
    );
    let n = 0;
    return {
      async write(dataUrl) {
        const buf = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
        fs.writeFileSync(path.join(frameDir, `${String(n).padStart(6, '0')}.jpg`), buf);
        n += 1;
      },
      async close() {},
    };
  }

  // Guarda o desfecho do processo (exit code + cauda do stderr) ASSIM QUE
  // ele acontece, não só quando close() for chamado — um 'close'/'exit' que
  // dispara ANTES de close() registrar seu listener nunca seria entregue
  // (EventEmitter não reenvia eventos passados), e como ffmpeg processa o
  // stream inteiro de frames MUITO antes do roteiro terminar de rodar, ele
  // pode legitimamente sair (erro ou não) bem antes do nosso close(); sem
  // isso, o close() ficava esperando pra sempre um evento que já tinha
  // passado (achado rodando a gravação completa: processo ficava pendurado
  // até ser morto manualmente, e o .mp4 saía sem o átomo `moov` final).
  let exitInfo = null;
  const stderrTail = [];
  ffmpeg.stderr.on('data', (chunk) => {
    stderrTail.push(chunk.toString());
    if (stderrTail.length > 40) stderrTail.shift(); // só as últimas linhas importam pro diagnóstico
  });
  ffmpeg.stdin.on('error', () => {}); // evita "unhandled 'error'" se o processo já tiver morrido
  ffmpeg.once('close', (code) => {
    exitInfo = { code };
    if (code !== 0) {
      console.warn(`[record-demo] ffmpeg saiu com código ${code}. Últimas linhas de stderr:\n${stderrTail.join('')}`);
    }
  });

  return {
    async write(dataUrl) {
      if (exitInfo) return; // processo já morreu — não adianta mais escrever
      const buf = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
      if (!ffmpeg.stdin.write(buf)) {
        await new Promise((resolve) => ffmpeg.stdin.once('drain', resolve));
      }
    },
    async close() {
      if (exitInfo) return; // 'close' já disparou antes de chegarmos aqui
      await new Promise((resolve) => {
        ffmpeg.once('close', resolve);
        try {
          ffmpeg.stdin.end();
        } catch {
          resolve();
        }
      });
    },
  };
}
