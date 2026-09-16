const { app } = require('@azure/functions');
const playersRepo = require('../lib/playersRepo');
const { mapRepoError } = require('../lib/httpErrors');

async function settingsGet(request) {
  const { playerId } = request.params;
  const player = await playersRepo.getById(playerId);
  if (!player) {
    return { status: 404, jsonBody: { error: 'playerId não encontrado' } };
  }
  return { jsonBody: playersRepo.toPublicPlayer(player) };
}

async function settingsUpdate(request) {
  const { playerId } = request.params;

  let body;
  try {
    body = await request.json();
  } catch {
    return { status: 400, jsonBody: { error: 'corpo inválido' } };
  }

  try {
    let player = null;

    if (body.name !== undefined) {
      player = await playersRepo.rename(playerId, body.name);
    }

    if (body.settings !== undefined) {
      player = await playersRepo.updateSettings(playerId, body.settings);
    }

    if (!player) {
      const existing = await playersRepo.getById(playerId);
      if (!existing) {
        return { status: 404, jsonBody: { error: 'playerId não encontrado' } };
      }
      player = playersRepo.toPublicPlayer(existing);
    }

    return { jsonBody: player };
  } catch (err) {
    return mapRepoError(err);
  }
}

app.http('settingsGet', {
  methods: ['GET'],
  route: 'settings/{playerId}',
  authLevel: 'anonymous',
  handler: settingsGet,
});

app.http('settingsUpdate', {
  methods: ['PATCH'],
  route: 'settings/{playerId}',
  authLevel: 'anonymous',
  handler: settingsUpdate,
});

module.exports = { settingsGet, settingsUpdate };
