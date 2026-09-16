'use strict';

// Precisa ser setado ANTES de qualquer require de src/lib ou src/functions —
// tableClients.js lê AZURE_TABLES_CONNECTION_STRING uma única vez, no
// carregamento do módulo.
process.env.AZURE_TABLES_CONNECTION_STRING = 'UseDevelopmentStorage=true';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { startAzuriteTable } = require('../scripts/azurite');

const playersRepo = require('../src/lib/playersRepo');
const { settingsRegister } = require('../src/functions/settingsRegister');
const { settingsLogin } = require('../src/functions/settingsLogin');
const { settingsGet, settingsUpdate } = require('../src/functions/settings');
const { postScores } = require('../src/functions/scores');
const { getLeaderboard } = require('../src/functions/leaderboard');
const { progressGet, progressUpdate } = require('../src/functions/progress');

let azurite;

before(async () => {
  azurite = await startAzuriteTable();
});

after(async () => {
  await azurite.stop();
});

function uniqueName(prefix) {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

// Simula o objeto HttpRequest do Azure Functions v4 — os handlers só usam
// .json() e .params, então não precisa de nada além disso.
function jsonRequest(body, params) {
  return { params: params ?? {}, json: async () => body };
}

function invalidJsonRequest() {
  return {
    params: {},
    json: async () => {
      throw new Error('corpo não é JSON válido');
    },
  };
}

// Handlers de sucesso não setam `status` explicitamente (o runtime real
// assume 200 nesse caso) — só as respostas de erro setam status.
function assertOk(response) {
  assert.ok(
    response.status === undefined || response.status === 200,
    `esperava 200/implícito, recebeu ${response.status}`
  );
}

describe('playersRepo', () => {
  test('createPlayer cria jogador com dados válidos', async () => {
    const player = await playersRepo.createPlayer({ name: uniqueName('Ana'), pin: '1234' });
    assert.equal(typeof player.playerId, 'string');
    assert.deepEqual(player.settings, {});
  });

  test('createPlayer rejeita nome muito curto ou muito longo', async () => {
    await assert.rejects(
      playersRepo.createPlayer({ name: 'A', pin: '1234' }),
      (err) => err.code === 'VALIDATION'
    );
    await assert.rejects(
      playersRepo.createPlayer({ name: 'A'.repeat(30), pin: '1234' }),
      (err) => err.code === 'VALIDATION'
    );
  });

  test('createPlayer rejeita PIN fora do formato', async () => {
    await assert.rejects(
      playersRepo.createPlayer({ name: uniqueName('Bob'), pin: '12' }),
      (err) => err.code === 'VALIDATION'
    );
    await assert.rejects(
      playersRepo.createPlayer({ name: uniqueName('Bob'), pin: 'abcd' }),
      (err) => err.code === 'VALIDATION'
    );
  });

  test('createPlayer rejeita nome duplicado (case-insensitive) sem corromper o original', async () => {
    const name = uniqueName('Carla');
    const first = await playersRepo.createPlayer({ name, pin: '1111' });

    await assert.rejects(
      playersRepo.createPlayer({ name: name.toUpperCase(), pin: '2222' }),
      (err) => err.code === 'NAME_TAKEN'
    );

    // Se o rollback do byId órfão tivesse falhado ou corrompido o índice,
    // o login original pararia de funcionar.
    const logged = await playersRepo.login({ name, pin: '1111' });
    assert.equal(logged.playerId, first.playerId);
  });

  test('login: PIN certo, PIN errado e nome inexistente', async () => {
    const name = uniqueName('Diego');
    await playersRepo.createPlayer({ name, pin: '4321' });

    const ok = await playersRepo.login({ name, pin: '4321' });
    assert.equal(ok.name, name);

    await assert.rejects(playersRepo.login({ name, pin: '0000' }), (err) => err.code === 'INVALID_PIN');
    await assert.rejects(
      playersRepo.login({ name: uniqueName('inexistente'), pin: '4321' }),
      (err) => err.code === 'NOT_FOUND'
    );
  });

  test('rename libera o nome antigo e bloqueia nome já em uso', async () => {
    const nameA = uniqueName('Eva');
    const nameB = uniqueName('Fabio');
    const playerA = await playersRepo.createPlayer({ name: nameA, pin: '1234' });
    await playersRepo.createPlayer({ name: nameB, pin: '5678' });

    const newName = uniqueName('EvaNova');
    const renamed = await playersRepo.rename(playerA.playerId, newName);
    assert.equal(renamed.name, newName);

    await assert.rejects(
      playersRepo.login({ name: nameA, pin: '1234' }),
      (err) => err.code === 'NOT_FOUND'
    );

    await assert.rejects(
      playersRepo.rename(playerA.playerId, nameB),
      (err) => err.code === 'NAME_TAKEN'
    );
  });

  test('rename para o mesmo nome é no-op', async () => {
    const name = uniqueName('Gustavo');
    const player = await playersRepo.createPlayer({ name, pin: '1234' });
    const result = await playersRepo.rename(player.playerId, name);
    assert.equal(result.playerId, player.playerId);
    assert.equal(result.name, name);
  });

  test('updateSettings faz merge raso e preserva chaves de chamadas anteriores', async () => {
    const name = uniqueName('Helena');
    const player = await playersRepo.createPlayer({ name, pin: '1234' });

    await playersRepo.updateSettings(player.playerId, { audioVolume: 0.5 });
    const second = await playersRepo.updateSettings(player.playerId, { locomotion: 'teleport' });

    assert.deepEqual(second.settings, { audioVolume: 0.5, locomotion: 'teleport' });
  });

  test('updateSettings rejeita valor que não é objeto', async () => {
    const name = uniqueName('Igor');
    const player = await playersRepo.createPlayer({ name, pin: '1234' });
    await assert.rejects(
      playersRepo.updateSettings(player.playerId, ['nope']),
      (err) => err.code === 'VALIDATION'
    );
  });

  test('operações num playerId inexistente retornam NOT_FOUND', async () => {
    const fakeId = randomUUID();
    await assert.rejects(playersRepo.rename(fakeId, uniqueName('Julia')), (err) => err.code === 'NOT_FOUND');
    await assert.rejects(playersRepo.updateSettings(fakeId, {}), (err) => err.code === 'NOT_FOUND');
    assert.equal(await playersRepo.getById(fakeId), null);
  });
});

describe('HTTP handlers', () => {
  test('settingsRegister: sucesso e corpo inválido', async () => {
    const ok = await settingsRegister(jsonRequest({ name: uniqueName('Karen'), pin: '1234' }));
    assert.equal(ok.status, 201);
    assert.equal(typeof ok.jsonBody.playerId, 'string');

    const badJson = await settingsRegister(invalidJsonRequest());
    assert.equal(badJson.status, 400);
  });

  test('settingsRegister: nome duplicado retorna 409', async () => {
    const name = uniqueName('Lucas');
    await settingsRegister(jsonRequest({ name, pin: '1234' }));
    const dup = await settingsRegister(jsonRequest({ name, pin: '5678' }));
    assert.equal(dup.status, 409);
  });

  test('settingsLogin: 200, 401 e 404', async () => {
    const name = uniqueName('Marina');
    await settingsRegister(jsonRequest({ name, pin: '1234' }));

    const ok = await settingsLogin(jsonRequest({ name, pin: '1234' }));
    assertOk(ok);
    assert.equal(ok.jsonBody.name, name);

    const wrongPin = await settingsLogin(jsonRequest({ name, pin: '0000' }));
    assert.equal(wrongPin.status, 401);

    const unknown = await settingsLogin(jsonRequest({ name: uniqueName('ninguem'), pin: '1234' }));
    assert.equal(unknown.status, 404);
  });

  test('settingsGet: 200 e 404', async () => {
    const name = uniqueName('Nina');
    const created = await settingsRegister(jsonRequest({ name, pin: '1234' }));

    const found = await settingsGet(jsonRequest(null, { playerId: created.jsonBody.playerId }));
    assertOk(found);
    assert.equal(found.jsonBody.name, name);

    const notFound = await settingsGet(jsonRequest(null, { playerId: randomUUID() }));
    assert.equal(notFound.status, 404);
  });

  test('settingsUpdate: renomeia e atualiza settings numa única chamada', async () => {
    const name = uniqueName('Otavio');
    const created = await settingsRegister(jsonRequest({ name, pin: '1234' }));
    const playerId = created.jsonBody.playerId;
    const newName = uniqueName('OtavioNovo');

    const updated = await settingsUpdate(
      jsonRequest({ name: newName, settings: { audioVolume: 0.3 } }, { playerId })
    );

    assertOk(updated);
    assert.equal(updated.jsonBody.name, newName);
    assert.deepEqual(updated.jsonBody.settings, { audioVolume: 0.3 });
  });

  test('settingsUpdate: renomear para nome já usado retorna 409', async () => {
    const nameA = uniqueName('Paula');
    const nameB = uniqueName('Quenia');
    const createdA = await settingsRegister(jsonRequest({ name: nameA, pin: '1234' }));
    await settingsRegister(jsonRequest({ name: nameB, pin: '1234' }));

    const conflict = await settingsUpdate(
      jsonRequest({ name: nameB }, { playerId: createdA.jsonBody.playerId })
    );
    assert.equal(conflict.status, 409);
  });

  test('postScores: valida playerId, score e deathsCaused', async () => {
    const missingPlayer = await postScores(jsonRequest({ playerId: randomUUID(), score: 100 }));
    assert.equal(missingPlayer.status, 404);

    const registered = await settingsRegister(jsonRequest({ name: uniqueName('Rafael'), pin: '1234' }));
    const playerId = registered.jsonBody.playerId;

    const badScore = await postScores(jsonRequest({ playerId, score: 'abc' }));
    assert.equal(badScore.status, 400);

    const badDeaths = await postScores(jsonRequest({ playerId, score: 10, deathsCaused: -1 }));
    assert.equal(badDeaths.status, 400);

    const ok = await postScores(jsonRequest({ playerId, score: 100, deathsCaused: 2 }));
    assert.equal(ok.status, 201);
  });

  test('leaderboard: ordena desc e resolve o nome atual do jogador', async () => {
    const nameLow = uniqueName('Sara');
    const nameHigh = uniqueName('Tiago');
    const low = await settingsRegister(jsonRequest({ name: nameLow, pin: '1234' }));
    const high = await settingsRegister(jsonRequest({ name: nameHigh, pin: '1234' }));

    await postScores(jsonRequest({ playerId: low.jsonBody.playerId, score: 50 }));
    await postScores(jsonRequest({ playerId: high.jsonBody.playerId, score: 999 }));

    const renamedHigh = uniqueName('TiagoNovo');
    await settingsUpdate(jsonRequest({ name: renamedHigh }, { playerId: high.jsonBody.playerId }));

    const board = await getLeaderboard();
    assertOk(board);

    const entryHigh = board.jsonBody.find((e) => e.playerId === high.jsonBody.playerId);
    const entryLow = board.jsonBody.find((e) => e.playerId === low.jsonBody.playerId);

    assert.equal(entryHigh.name, renamedHigh, 'leaderboard deve mostrar o nome atual, pós-rename');
    assert.ok(board.jsonBody.indexOf(entryHigh) < board.jsonBody.indexOf(entryLow), 'maior score deve vir primeiro');
  });

  test('progress: default, update parcial e validação', async () => {
    const registered = await settingsRegister(jsonRequest({ name: uniqueName('Ursula'), pin: '1234' }));
    const playerId = registered.jsonBody.playerId;

    const initial = await progressGet(jsonRequest(null, { playerId }));
    assertOk(initial);
    assert.equal(initial.jsonBody.highestPhaseUnlocked, 1);
    assert.equal(initial.jsonBody.currentPhase, 1);

    await progressUpdate(jsonRequest({ highestPhaseUnlocked: 3, currentPhase: 2 }, { playerId }));
    const partial = await progressUpdate(jsonRequest({ currentPhase: 3 }, { playerId }));
    assertOk(partial);
    assert.equal(partial.jsonBody.highestPhaseUnlocked, 3, 'update parcial não deve regredir o campo não enviado');
    assert.equal(partial.jsonBody.currentPhase, 3);

    const invalid = await progressUpdate(jsonRequest({ currentPhase: 0 }, { playerId }));
    assert.equal(invalid.status, 400);

    const notFound = await progressGet(jsonRequest(null, { playerId: randomUUID() }));
    assert.equal(notFound.status, 404);
  });
});
