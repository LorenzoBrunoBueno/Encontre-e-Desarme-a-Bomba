const { app } = require('@azure/functions');
const { ensureTable } = require('../lib/tableClients');
const playersRepo = require('../lib/playersRepo');

const TABLE_NAME = 'progress';
const ROW_KEY = 'state';
const DEFAULT_PHASE = 1;

async function getProgressEntity(client, playerId) {
  try {
    return await client.getEntity(playerId, ROW_KEY);
  } catch (err) {
    if (err?.statusCode === 404) return null;
    throw err;
  }
}

function toPublicProgress(playerId, entity) {
  return {
    playerId,
    highestPhaseUnlocked: entity ? entity.highestPhaseUnlocked : DEFAULT_PHASE,
    currentPhase: entity ? entity.currentPhase : DEFAULT_PHASE,
    updatedAt: entity ? entity.updatedAt : null,
  };
}

async function progressGet(request) {
  const { playerId } = request.params;

  const player = await playersRepo.getById(playerId);
  if (!player) {
    return { status: 404, jsonBody: { error: 'playerId não encontrado' } };
  }

  const client = await ensureTable(TABLE_NAME);
  const entity = await getProgressEntity(client, playerId);

  return { jsonBody: toPublicProgress(playerId, entity) };
}

async function progressUpdate(request) {
  const { playerId } = request.params;

  const player = await playersRepo.getById(playerId);
  if (!player) {
    return { status: 404, jsonBody: { error: 'playerId não encontrado' } };
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return { status: 400, jsonBody: { error: 'corpo inválido' } };
  }

  const { highestPhaseUnlocked, currentPhase } = body;

  if (
    highestPhaseUnlocked !== undefined &&
    (!Number.isInteger(highestPhaseUnlocked) || highestPhaseUnlocked < 1)
  ) {
    return { status: 400, jsonBody: { error: 'highestPhaseUnlocked deve ser um inteiro >= 1' } };
  }
  if (currentPhase !== undefined && (!Number.isInteger(currentPhase) || currentPhase < 1)) {
    return { status: 400, jsonBody: { error: 'currentPhase deve ser um inteiro >= 1' } };
  }

  const client = await ensureTable(TABLE_NAME);
  const existing = await getProgressEntity(client, playerId);
  const now = new Date().toISOString();

  const merged = {
    partitionKey: playerId,
    rowKey: ROW_KEY,
    highestPhaseUnlocked: highestPhaseUnlocked ?? existing?.highestPhaseUnlocked ?? DEFAULT_PHASE,
    currentPhase: currentPhase ?? existing?.currentPhase ?? DEFAULT_PHASE,
    updatedAt: now,
  };

  await client.upsertEntity(merged, 'Merge');

  return { jsonBody: toPublicProgress(playerId, merged) };
}

app.http('progressGet', {
  methods: ['GET'],
  route: 'progress/{playerId}',
  authLevel: 'anonymous',
  handler: progressGet,
});

app.http('progressUpdate', {
  methods: ['PATCH'],
  route: 'progress/{playerId}',
  authLevel: 'anonymous',
  handler: progressUpdate,
});

module.exports = { progressGet, progressUpdate };
