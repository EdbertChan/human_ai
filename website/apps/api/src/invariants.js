import { validatePersonaFields } from "./personas.js";

export const ALLOWED_REQUEST_KEYS = new Set(["text", "context", "persona", "customization", "distinctId"]);
export const ALLOWED_CONTEXT_KEYS = new Set([
  "app",
  "surface",
  "workspaceId",
  "conversationId",
  "channelName",
  "packageName",
  "conversation"
]);
export const MAX_CONVERSATION_ITEMS = 10;
export const MAX_CONVERSATION_ITEM_LENGTH = 500;
export const MAX_CONVERSATION_LENGTH = 4000;

export const ALLOWED_RESULT_KEYS = new Set([
  "acceptable",
  "categories",
  "original",
  "replacement",
  "policyVersion",
  "provider"
]);
export const MAX_REPLACEMENT_LENGTH = 8000;

export class InvariantError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "InvariantError";
    this.code = code;
  }
}

export function checkInbound(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "Request body must be a JSON object.";
  }
  for (const key of Object.keys(value)) {
    if (!ALLOWED_REQUEST_KEYS.has(key)) {
      return `Unexpected field: ${key}.`;
    }
  }
  if (typeof value.text !== "string" || value.text.trim().length === 0) return "text is required.";
  if (value.text.length > 4000) return "text must be 4,000 characters or fewer.";
  if (value.context !== undefined) {
    if (typeof value.context !== "object" || value.context === null || Array.isArray(value.context)) {
      return "context must be an object.";
    }
    for (const key of Object.keys(value.context)) {
      if (!ALLOWED_CONTEXT_KEYS.has(key)) {
        return `context.${key} is not allowed.`;
      }
    }
    if (value.context.conversation !== undefined) {
      const conversation = value.context.conversation;
      if (!Array.isArray(conversation) || conversation.length > MAX_CONVERSATION_ITEMS) {
        return `context.conversation must contain at most ${MAX_CONVERSATION_ITEMS} messages.`;
      }
      let totalLength = 0;
      for (const message of conversation) {
        if (typeof message !== "string" || message.length > MAX_CONVERSATION_ITEM_LENGTH) {
          return `context.conversation messages must be strings of ${MAX_CONVERSATION_ITEM_LENGTH} characters or fewer.`;
        }
        totalLength += message.length;
      }
      if (totalLength > MAX_CONVERSATION_LENGTH) {
        return `context.conversation must be ${MAX_CONVERSATION_LENGTH} characters or fewer.`;
      }
    }
  }
  if (value.distinctId !== undefined && (typeof value.distinctId !== "string" || !/^[a-f0-9-]{16,64}$/.test(value.distinctId))) {
    return "distinctId must be a 16-64 character anonymous id.";
  }
  return validatePersonaFields(value);
}

export function assertOutbound(result, { text, policyVersion }) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new InvariantError("outbound_invalid", "Result must be an object.");
  }
  for (const key of Object.keys(result)) {
    if (!ALLOWED_RESULT_KEYS.has(key)) {
      throw new InvariantError("outbound_invalid", `Unexpected result field: ${key}.`);
    }
  }
  if (typeof result.acceptable !== "boolean") {
    throw new InvariantError("outbound_invalid", "acceptable must be a boolean.");
  }
  if (!Array.isArray(result.categories) || result.categories.some((item) => typeof item !== "string")) {
    throw new InvariantError("outbound_invalid", "categories must be an array of strings.");
  }
  if (typeof result.original !== "string") {
    throw new InvariantError("outbound_invalid", "original must be a string.");
  }
  if (result.original !== text) {
    throw new InvariantError("outbound_invalid", "original must match request text.");
  }
  if (typeof result.replacement !== "string") {
    throw new InvariantError("outbound_invalid", "replacement must be a string.");
  }
  if (result.replacement.length > MAX_REPLACEMENT_LENGTH) {
    throw new InvariantError("outbound_invalid", "replacement exceeds maximum length.");
  }
  if (typeof result.policyVersion !== "string" || result.policyVersion !== policyVersion) {
    throw new InvariantError("outbound_invalid", "policyVersion must match resolved persona.");
  }
  if (typeof result.provider !== "string" || result.provider.trim().length === 0) {
    throw new InvariantError("outbound_invalid", "provider must be a non-empty string.");
  }
}
