const { TableClient } = require('@azure/data-tables');

const connectionString = process.env.AZURE_TABLES_CONNECTION_STRING;
const clients = new Map();
const ensuredTables = new Set();

function getTableClient(tableName) {
  if (!clients.has(tableName)) {
    clients.set(tableName, TableClient.fromConnectionString(connectionString, tableName));
  }
  return clients.get(tableName);
}

// createTable() é idempotente, mas custa uma chamada HTTP — memorizamos por
// tableName pra só pagar esse custo uma vez por instância "quente" do host.
async function ensureTable(tableName) {
  const client = getTableClient(tableName);
  if (!ensuredTables.has(tableName)) {
    await client.createTable();
    ensuredTables.add(tableName);
  }
  return client;
}

module.exports = { getTableClient, ensureTable };
