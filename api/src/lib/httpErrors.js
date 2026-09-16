const { RepoError } = require('./playersRepo');

const STATUS_BY_CODE = {
  VALIDATION: 400,
  NAME_TAKEN: 409,
  NOT_FOUND: 404,
  INVALID_PIN: 401,
};

function mapRepoError(err) {
  if (err instanceof RepoError) {
    return { status: STATUS_BY_CODE[err.code] ?? 400, jsonBody: { error: err.message } };
  }
  throw err;
}

module.exports = { mapRepoError };
