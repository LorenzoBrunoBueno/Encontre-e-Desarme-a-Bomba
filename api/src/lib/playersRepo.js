const { randomUUID } = require('crypto');
const { ensureTable } = require('./tableClients');
const { hashPin, verifyPin } = require('./pin');

const TABLE_NAME = 'players';
const NAME_MIN_LENGTH = 2;
const NAME_MAX_LENGTH = 24;
const PIN_PATTERN = /^\d{4,6}$/;

class RepoError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function normalizeName(name) {
  return name.trim().toLowerCase();
}

function validateName(name) {
  if (typeof name !== 'string') {
    throw new RepoError('VALIDATION', 'name é obrigatório');
  }
  const trimmed = name.trim();
  if (trimmed.length < NAME_MIN_LENGTH || trimmed.length > NAME_MAX_LENGTH) {
    throw new RepoError(
      'VALIDATION',
      `name deve ter entre ${NAME_MIN_LENGTH} e ${NAME_MAX_LENGTH} caracteres`
    );
  }
  return trimmed;
}

function validatePin(pin) {
  if (typeof pin !== 'string' || !PIN_PATTERN.test(pin)) {
    throw new RepoError('VALIDATION', 'pin deve ter entre 4 e 6 dígitos numéricos');
  }
  return pin;
}

function isConflict(err) {
  return err?.statusCode === 409;
}

function isNotFound(err) {
  return err?.statusCode === 404;
}

function toPublicPlayer(entity) {
  return {
    playerId: entity.rowKey,
    name: entity.name,
    settings: JSON.parse(entity.settings || '{}'),
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}

async function getById(playerId) {
  const client = await ensureTable(TABLE_NAME);
  try {
    return await client.getEntity('byId', playerId);
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

async function getByName(normalizedName) {
  const client = await ensureTable(TABLE_NAME);
  try {
    return await client.getEntity('byName', normalizedName);
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

async function createPlayer({ name, pin }) {
  const trimmedName = validateName(name);
  validatePin(pin);
  const normalized = normalizeName(trimmedName);

  const client = await ensureTable(TABLE_NAME);
  const playerId = randomUUID();
  const { salt, hash } = hashPin(pin);
  const now = new Date().toISOString();

  // byId primeiro: playerId é um UUID novo, então essa inserção nunca
  // conflita. Só byName pode falhar por nome duplicado — se falhar,
  // desfazemos o byId pra não deixar órfão.
  await client.createEntity({
    partitionKey: 'byId',
    rowKey: playerId,
    name: trimmedName,
    pinSalt: salt,
    pinHash: hash,
    settings: '{}',
    createdAt: now,
    updatedAt: now,
  });

  try {
    await client.createEntity({ partitionKey: 'byName', rowKey: normalized, playerId });
  } catch (err) {
    await client.deleteEntity('byId', playerId).catch(() => {});
    if (isConflict(err)) {
      throw new RepoError('NAME_TAKEN', 'Esse nome já está em uso');
    }
    throw err;
  }

  return { playerId, name: trimmedName, settings: {}, createdAt: now, updatedAt: now };
}

async function login({ name, pin }) {
  const normalized = normalizeName(validateName(name));
  validatePin(pin);

  const nameEntity = await getByName(normalized);
  if (!nameEntity) {
    throw new RepoError('NOT_FOUND', 'Jogador não encontrado');
  }

  const player = await getById(nameEntity.playerId);
  if (!player) {
    throw new RepoError('NOT_FOUND', 'Jogador não encontrado');
  }

  if (!verifyPin(pin, player.pinSalt, player.pinHash)) {
    throw new RepoError('INVALID_PIN', 'PIN incorreto');
  }

  return toPublicPlayer(player);
}

async function rename(playerId, newName) {
  const player = await getById(playerId);
  if (!player) {
    throw new RepoError('NOT_FOUND', 'Jogador não encontrado');
  }

  const trimmedName = validateName(newName);
  const normalized = normalizeName(trimmedName);
  const currentNormalized = normalizeName(player.name);

  if (normalized === currentNormalized) {
    return toPublicPlayer(player);
  }

  const client = await ensureTable(TABLE_NAME);

  try {
    await client.createEntity({ partitionKey: 'byName', rowKey: normalized, playerId });
  } catch (err) {
    if (isConflict(err)) {
      throw new RepoError('NAME_TAKEN', 'Esse nome já está em uso');
    }
    throw err;
  }

  const now = new Date().toISOString();
  await client.updateEntity(
    { partitionKey: 'byId', rowKey: playerId, name: trimmedName, updatedAt: now },
    'Merge'
  );

  // Best-effort: se essa exclusão falhar, sobra um RowKey antigo apontando
  // pro mesmo playerId em byName — inofensivo (só "reserva" um nome extra
  // que ninguém mais pode usar), não compromete a conta em si.
  await client.deleteEntity('byName', currentNormalized).catch(() => {});

  return toPublicPlayer({ ...player, name: trimmedName, updatedAt: now });
}

async function updateSettings(playerId, settingsPatch) {
  const player = await getById(playerId);
  if (!player) {
    throw new RepoError('NOT_FOUND', 'Jogador não encontrado');
  }

  if (
    typeof settingsPatch !== 'object' ||
    settingsPatch === null ||
    Array.isArray(settingsPatch)
  ) {
    throw new RepoError('VALIDATION', 'settings deve ser um objeto');
  }

  const currentSettings = JSON.parse(player.settings || '{}');
  const merged = { ...currentSettings, ...settingsPatch };
  const now = new Date().toISOString();

  const client = await ensureTable(TABLE_NAME);
  await client.updateEntity(
    { partitionKey: 'byId', rowKey: playerId, settings: JSON.stringify(merged), updatedAt: now },
    'Merge'
  );

  return toPublicPlayer({ ...player, settings: JSON.stringify(merged), updatedAt: now });
}

module.exports = {
  RepoError,
  getById,
  createPlayer,
  login,
  rename,
  updateSettings,
  toPublicPlayer,
};
