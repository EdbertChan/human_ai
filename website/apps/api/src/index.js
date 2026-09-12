import { createServer } from "node:http";
import { createHandler } from "./app.js";
import { createPool, migrate } from "./db.js";
import { createPostgresRunStore } from "./runs.js";
import { createPostgresAccountDeviceStore } from "./account-devices.js";
import { parseEncryptionKey } from "./crypto.js";
import { maintainRuns } from "./executor.js";
import { toWebRequest, sendWebResponse } from "./node-adapter.js";

const databaseUrl = process.env.DATABASE_URL;
const encryptionKeyValue = process.env.EMPATHY_RUN_ENCRYPTION_KEY;

if (!databaseUrl || !encryptionKeyValue) {
  console.error("DATABASE_URL and EMPATHY_RUN_ENCRYPTION_KEY are required to start the API.");
  process.exit(1);
}

const encryptionKey = parseEncryptionKey(encryptionKeyValue);
const pool = createPool(databaseUrl);
await migrate(pool);
const store = createPostgresRunStore(pool);

const handler = createHandler(process.env, { store, encryptionKey, accountDeviceStore: createPostgresAccountDeviceStore(pool) });
const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "127.0.0.1";

await maintainRuns(store);
const maintenance = setInterval(() => {
  maintainRuns(store).catch((error) => {
    console.error("rewrite_runs maintenance failed", error.code ?? error.message);
  });
}, 30_000);
maintenance.unref?.();

const server = createServer(async (request, response) => {
  const webResponse = await handler(await toWebRequest(request));
  await sendWebResponse(webResponse, response);
});

server.listen(port, host, () => {
  console.log(`EmapthyAi API listening on http://${host}:${port}`);
});
