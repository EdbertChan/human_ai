import { checkInbound } from "./invariants.js";

export function validateRewriteRequest(value) {
  return checkInbound(value);
}
