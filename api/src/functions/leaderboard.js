const { app } = require('@azure/functions');
const { ensureTable } = require('../lib/tableClients');
const playersRepo = require('../lib/playersRepo');

const TABLE_NAME = 'scores';
const LEADERBOARD_SIZE = 10;

async function getLeaderboard() {
  const client = await ensureTable(TABLE_NAME);

  const entries = [];
  for await (const entity of client.listEntities()) {
    entries.push(entity);
  }

  entries.sort((a, b) => b.score - a.score);
  const top = entries.slice(0, LEADERBOARD_SIZE);

  // Nome resolvido em tempo de leitura (não guardado no score) — uma
  // troca de nome do jogador aparece aqui imediatamente. Só resolve os
  // playerIds distintos entre os top N, então o custo fica pequeno mesmo
  // varrendo a tabela inteira de scores.
  const nameCache = new Map();
  const leaderboard = [];

  for (const entry of top) {
    const playerId = entry.partitionKey;
    if (!nameCache.has(playerId)) {
      const player = await playersRepo.getById(playerId);
      nameCache.set(playerId, player ? player.name : '(desconhecido)');
    }
    leaderboard.push({
      playerId,
      name: nameCache.get(playerId),
      score: entry.score,
      deathsCaused: entry.deathsCaused,
      createdAt: entry.createdAt,
    });
  }

  return { jsonBody: leaderboard };
}

app.http('leaderboard', {
  methods: ['GET'],
  route: 'leaderboard',
  authLevel: 'anonymous',
  handler: getLeaderboard,
});

module.exports = { getLeaderboard };
