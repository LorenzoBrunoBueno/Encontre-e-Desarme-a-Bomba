const { app } = require('@azure/functions');
const playersRepo = require('../lib/playersRepo');
const { mapRepoError } = require('../lib/httpErrors');

async function settingsRegister(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return { status: 400, jsonBody: { error: 'corpo inválido' } };
  }

  try {
    const player = await playersRepo.createPlayer({ name: body.name, pin: body.pin });
    return { status: 201, jsonBody: player };
  } catch (err) {
    return mapRepoError(err);
  }
}

app.http('settingsRegister', {
  methods: ['POST'],
  route: 'settings/register',
  authLevel: 'anonymous',
  handler: settingsRegister,
});

module.exports = { settingsRegister };
