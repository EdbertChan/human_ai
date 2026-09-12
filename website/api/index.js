import { createHandler } from "../apps/api/src/app.js";
import { toWebRequest, sendWebResponse } from "../apps/api/src/node-adapter.js";
import { createPool, migrate } from "../apps/api/src/db.js";
import { createPostgresRunStore } from "../apps/api/src/runs.js";
import { createPostgresAccountDeviceStore } from "../apps/api/src/account-devices.js";
import { parseEncryptionKey } from "../apps/api/src/crypto.js";

const handlerPromise = (async () => {
  const databaseUrl = process.env.DATABASE_URL;
  const encryptionKeyValue = process.env.EMPATHY_RUN_ENCRYPTION_KEY;
  if (!databaseUrl || !encryptionKeyValue) {
    throw new Error("DATABASE_URL and EMPATHY_RUN_ENCRYPTION_KEY are required.");
  }
  const pool = createPool(databaseUrl);
  await migrate(pool);
  return createHandler(process.env, {
    store: createPostgresRunStore(pool),
    encryptionKey: parseEncryptionKey(encryptionKeyValue),
    accountDeviceStore: createPostgresAccountDeviceStore(pool)
  });
})();

export default async function vercelHandler(request, response) {
  const incoming = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
  const routedPath = incoming.searchParams.get("path");
  const webResponse = await (await handlerPromise)(await toWebRequest(request, routedPath || null));
  await sendWebResponse(webResponse, response);
}
