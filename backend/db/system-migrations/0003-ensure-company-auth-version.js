export async function up({ context: db }) {
  void db;
}

export async function down() {
  throw new Error("Down migrations are not supported for the runtime SQLite migration layer");
}
