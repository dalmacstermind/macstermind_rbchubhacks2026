// Earlier versions (called FinCount) saved this computer's settings under "fincount.*" keys
// (theme, preferences, last person). Move them to "tide.*" once at start-up, so they're kept after
// the rename. Settings already saved under the new name win.
type KeyStorage = Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">;

const OLD = "fincount.";
const NEW = "tide.";

export function moveOldSettings(storage: KeyStorage): void {
  try {
    const oldKeys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(OLD)) oldKeys.push(key);
    }
    for (const key of oldKeys) {
      const value = storage.getItem(key);
      const newKey = NEW + key.slice(OLD.length);
      if (value !== null && storage.getItem(newKey) === null) storage.setItem(newKey, value);
      storage.removeItem(key);
    }
  } catch {
    /* storage isn't available: nothing to move */
  }
}
