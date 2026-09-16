const { app } = require('@azure/functions');
const playersRepo = require('../lib/playersRepo');
const { mapRepoError } = require('../lib/httpErrors');

async function settingsLogin(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return { status: 400, jsonBody: { error: 'corpo inválido' } };
  }

  try {
    const player = await playersRepo.login({ name: body.name, pin: body.pin });
    return { jsonBody: player };
  } catch (err) {
    return mapRepoError(err);
  }
}

app.http('settingsLogin', {
  methods: ['POST'],
  route: 'settings/login',
  authLevel: 'anonymous',
  handler: settingsLogin,
});

module.exports = { settingsLogin };
