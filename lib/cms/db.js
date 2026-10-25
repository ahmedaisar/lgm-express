"use strict";

const store = require("./store");

function useSupabase() {
  return process.env.CMS_SOURCE === "supabase" &&
    Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

async function list(dbPath) { return store.list(dbPath); }
async function get(id, dbPath) { return store.get(id, dbPath); }
async function create(input, dbPath) { return store.create(input, dbPath); }
async function update(id, patch, dbPath) { return store.update(id, patch, dbPath); }
async function remove(id, dbPath) { return store.remove(id, dbPath); }
async function query(dbPath, options = {}) {
  const all = store.list(dbPath);
  const result = store.query(all, options);
  if (options.page === undefined && options.per_page === undefined && Array.isArray(result)) {
    return { results: result, total: result.length, page: 1, per_page: result.length };
  }
  return result;
}

module.exports = { useSupabase, list, get, create, update, remove, query };
