import { isValidDistinctId } from "./product-telemetry.js";

export function createMemoryAccountDeviceStore() {
  const bindings = new Map();
  return {
    async bindDevice(deviceDistinctId, accountDistinctId) {
      const existing = bindings.get(deviceDistinctId);
      if (existing && existing !== accountDistinctId) return false;
      bindings.set(deviceDistinctId, accountDistinctId);
      return true;
    },
    async accountDistinctIdForDevice(deviceDistinctId) {
      return bindings.get(deviceDistinctId) ?? null;
    },
    _bindings: bindings
  };
}

export function createPostgresAccountDeviceStore(pool) {
  return {
    async bindDevice(deviceDistinctId, accountDistinctId) {
      const result = await pool.query(
        `INSERT INTO account_devices (device_distinct_id, account_distinct_id)
         VALUES ($1, $2)
         ON CONFLICT (device_distinct_id) DO UPDATE
           SET updated_at = NOW()
           WHERE account_devices.account_distinct_id = EXCLUDED.account_distinct_id
         RETURNING device_distinct_id`,
        [deviceDistinctId, accountDistinctId]
      );
      return result.rowCount === 1;
    },
    async accountDistinctIdForDevice(deviceDistinctId) {
      const result = await pool.query(
        `SELECT account_distinct_id FROM account_devices WHERE device_distinct_id = $1`,
        [deviceDistinctId]
      );
      return result.rows[0]?.account_distinct_id ?? null;
    }
  };
}

export function validateDeviceBinding(value) {
  return value && typeof value === "object" && !Array.isArray(value) && isValidDistinctId(value.distinctId);
}
export async function accountDistinctIdForDevice(store, distinctId) {
  if (!store || !isValidDistinctId(distinctId)) return null;
  try {
    return await store.accountDistinctIdForDevice(distinctId);
  } catch {
    return null;
  }
}
