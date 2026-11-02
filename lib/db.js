import pg from 'pg';

// SQL DATE values are calendar dates, so keep them free of timezone conversion.
pg.types.setTypeParser(pg.types.builtins.DATE, value => value);

const pool = globalThis.__slabsplitPool || new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});
if (process.env.NODE_ENV !== 'production') globalThis.__slabsplitPool = pool;

export async function query(sql, params = []) { return pool.query(sql, params); }
export async function transaction(userId, work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Serialize cooperative application mutations, including registration, without
    // changing the PDF schema. Direct SQL writers must follow the same protocol.
    await client.query('SELECT pg_advisory_xact_lock(73781,1)');
    if (userId) await client.query("SELECT set_config('app.user_id',$1,true)", [String(userId)]);
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
