import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const QUARANTINE_FILE = path.join(HERE, "conversation-quarantine.json");

function loadQuarantine() {
  try {
    const parsed = JSON.parse(fs.readFileSync(QUARANTINE_FILE, "utf8"));
    return parsed && parsed.conversations && typeof parsed.conversations === "object"
      ? parsed.conversations
      : {};
  } catch {
    return {};
  }
}

export const QUARANTINED_CONVERSATIONS = loadQuarantine();
export const QUARANTINE_IDS = new Set(Object.keys(QUARANTINED_CONVERSATIONS));

export function isQuarantinedConversation(id) {
  return QUARANTINE_IDS.has(id);
}

export function quarantineReason(id) {
  return QUARANTINED_CONVERSATIONS[id] || null;
}
