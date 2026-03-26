const fs = require("fs");
const path = require("path");

const STORE_PATH = path.join(__dirname, ".spotify-accounts.json");

function defaultStore() {
  return {
    ownerAccount: {
      preferredDeviceId: process.env.SPOTIFY_DEVICE_ID?.trim() || null,
    },
    linkedUsers: {},
  };
}

function ensureStore() {
  if (!fs.existsSync(STORE_PATH)) {
    fs.writeFileSync(STORE_PATH, JSON.stringify(defaultStore(), null, 2));
  }
}

function getStore() {
  ensureStore();

  try {
    const parsed = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
    return {
      ownerAccount: {
        preferredDeviceId: parsed?.ownerAccount?.preferredDeviceId || null,
      },
      linkedUsers:
        parsed?.linkedUsers && typeof parsed.linkedUsers === "object"
          ? parsed.linkedUsers
          : {},
    };
  } catch {
    const store = defaultStore();
    fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
    return store;
  }
}

function writeStore(store) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

function getPreferredDeviceId() {
  return getStore().ownerAccount.preferredDeviceId || null;
}

function setPreferredDeviceId(deviceId) {
  const store = getStore();
  store.ownerAccount.preferredDeviceId = deviceId;
  writeStore(store);
}

module.exports = {
  getStore,
  getPreferredDeviceId,
  setPreferredDeviceId,
};
