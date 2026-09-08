import assert from "node:assert/strict";
import test from "node:test";
import { getDatabase } from "./database";

test("production requests reuse a single database pool", async () => {
  const previousEnvironment = process.env.NODE_ENV;
  const previousUrl = process.env.DATABASE_URL;
  const cache = globalThis as typeof globalThis & {
    chairlyDatabase?: ReturnType<typeof getDatabase>;
  };
  const previousPool = cache.chairlyDatabase;
  delete cache.chairlyDatabase;
  Object.assign(process.env, {
    NODE_ENV: "production",
    DATABASE_URL: previousUrl ?? "postgresql://localhost/pool-test",
  });
  const pools = new Set<ReturnType<typeof getDatabase>>();
  try {
    for (let request = 0; request < 100; request++) pools.add(getDatabase());
    assert.equal(pools.size, 1, "requests must not allocate fresh pools");
  } finally {
    await Promise.all([...pools].map((pool) => pool.client.end()));
    if (previousPool) cache.chairlyDatabase = previousPool;
    else delete cache.chairlyDatabase;
    if (previousEnvironment === undefined)
      Reflect.deleteProperty(process.env, "NODE_ENV");
    else Object.assign(process.env, { NODE_ENV: previousEnvironment });
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
  }
});
