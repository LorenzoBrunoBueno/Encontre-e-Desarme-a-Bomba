const { app } = require('@azure/functions');
const { randomUUID } = require('crypto');
const { ensureTable } = require('../lib/tableClients');
const playersRepo = require('../lib/playersRepo');

const TABLE_NAME = 'scores';

async function postScores(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return { status: 400, jsonBody: { error: 'corpo inválido' } };
  }

  const { playerId, score, deathsCaused } = body;

  if (typeof playerId !== 'string' || !playerId) {
    return { status: 400, jsonBody: { error: 'playerId é obrigatório' } };
  }
  if (typeof score !== 'number' || !Number.isFinite(score)) {
    return { status: 400, jsonBody: { error: 'score deve ser numérico' } };
  }
  if (deathsCaused !== undefined && (typeof deathsCaused !== 'number' || deathsCaused < 0)) {
    return { status: 400, jsonBody: { error: 'deathsCaused deve ser numérico e não-negativo' } };
  }

  const player = await playersRepo.getById(playerId);
  if (!player) {
    return { status: 404, jsonBody: { error: 'playerId não encontrado' } };
  }

  const client = await ensureTable(TABLE_NAME);
  const createdAt = new Date().toISOString();

  await client.createEntity({
    partitionKey: playerId,
    rowKey: randomUUID(),
    score,
    deathsCaused: deathsCaused ?? 0,
    createdAt,
  });

  return { status: 201, jsonBody: { success: true, createdAt } };
}

app.http('scores', {
  methods: ['POST'],
  route: 'scores',
  authLevel: 'anonymous',
  handler: postScores,
});

module.exports = { postScores };
