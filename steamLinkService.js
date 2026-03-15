const fs = require("fs");
const path = require("path");
const axios = require("axios");

const STEAM_LINKS_PATH = path.join(__dirname, ".steam-links.json");
const STEAM_API_BASE = "https://api.steampowered.com";

class SteamLinkError extends Error {
  constructor(message, userMessage, details = null) {
    super(message);
    this.name = "SteamLinkError";
    this.userMessage = userMessage;
    this.details = details;
  }
}

function getSteamApiKey() {
  const apiKey = String(process.env.STEAM_API_KEY || "").trim();

  if (!apiKey) {
    throw new SteamLinkError(
      "Missing STEAM_API_KEY",
      "Steam linking is not configured on this bot yet."
    );
  }

  return apiKey;
}

function loadSteamLinks() {
  if (!fs.existsSync(STEAM_LINKS_PATH)) {
    return {};
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(STEAM_LINKS_PATH, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    throw new SteamLinkError(
      "Failed to read Steam links store",
      "Steam links storage is invalid. Ask an admin to fix it.",
      error.message
    );
  }
}

function saveSteamLinks(links) {
  fs.writeFileSync(STEAM_LINKS_PATH, `${JSON.stringify(links, null, 2)}\n`, "utf8");
}

function normalizeSteamInput(input) {
  const raw = String(input || "").trim();

  if (!raw) {
    throw new SteamLinkError(
      "Missing Steam input",
      "Provide a Steam profile URL, custom profile URL, or SteamID64."
    );
  }

  if (/^\d{17}$/.test(raw)) {
    return { steamId: raw };
  }

  try {
    const url = new URL(raw);
    const parts = url.pathname.split("/").filter(Boolean);

    if (parts[0] === "profiles" && /^\d{17}$/.test(parts[1] || "")) {
      return { steamId: parts[1] };
    }

    if (parts[0] === "id" && parts[1]) {
      return { vanity: parts[1] };
    }
  } catch {
    return { vanity: raw.replace(/^@/, "") };
  }

  throw new SteamLinkError(
    "Unsupported Steam input",
    "Use a Steam profile URL, custom URL, or SteamID64."
  );
}

async function resolveVanityUrl(apiKey, vanity) {
  try {
    const response = await axios.get(
      `${STEAM_API_BASE}/ISteamUser/ResolveVanityURL/v1/`,
      {
        params: {
          key: apiKey,
          vanityurl: vanity,
        },
        timeout: 10000,
      }
    );

    const payload = response.data?.response;
    if (payload?.success !== 1 || !payload?.steamid) {
      throw new SteamLinkError(
        "ResolveVanityURL failed",
        "I couldn't resolve that Steam profile. Make sure the profile URL is correct."
      );
    }

    return payload.steamid;
  } catch (error) {
    if (error instanceof SteamLinkError) {
      throw error;
    }

    throw new SteamLinkError(
      "Steam vanity lookup failed",
      "I couldn't reach Steam to resolve that profile. Try again in a moment.",
      error.message
    );
  }
}

async function getPlayerSummary(apiKey, steamId) {
  try {
    const response = await axios.get(
      `${STEAM_API_BASE}/ISteamUser/GetPlayerSummaries/v2/`,
      {
        params: {
          key: apiKey,
          steamids: steamId,
        },
        timeout: 10000,
      }
    );

    const player = response.data?.response?.players?.[0];
    if (!player) {
      throw new SteamLinkError(
        "Steam profile not found",
        "I couldn't find a Steam profile for that account."
      );
    }

    return {
      steamId: player.steamid,
      personaName: player.personaname || "Unknown",
      profileUrl: player.profileurl || `https://steamcommunity.com/profiles/${player.steamid}`,
      avatarUrl: player.avatarfull || player.avatarmedium || player.avatar || null,
      visibilityState: player.communityvisibilitystate || 0,
    };
  } catch (error) {
    if (error instanceof SteamLinkError) {
      throw error;
    }

    throw new SteamLinkError(
      "Steam player lookup failed",
      "I couldn't read that Steam profile right now. Try again in a moment.",
      error.message
    );
  }
}

async function resolveSteamProfile(input) {
  const apiKey = getSteamApiKey();
  const normalized = normalizeSteamInput(input);
  const steamId = normalized.steamId || await resolveVanityUrl(apiKey, normalized.vanity);
  return getPlayerSummary(apiKey, steamId);
}

async function getRecentlyPlayedGames(steamId, count = 5) {
  const apiKey = getSteamApiKey();

  try {
    const response = await axios.get(
      `${STEAM_API_BASE}/IPlayerService/GetRecentlyPlayedGames/v1/`,
      {
        params: {
          key: apiKey,
          steamid: steamId,
          count,
        },
        timeout: 10000,
      }
    );

    return response.data?.response?.games || [];
  } catch (error) {
    throw new SteamLinkError(
      "Steam recent games lookup failed",
      "I couldn't read recent Steam games right now.",
      error.message
    );
  }
}

async function linkSteamAccount({ discordUserId, discordUsername, input }) {
  const profile = await resolveSteamProfile(input);
  const links = loadSteamLinks();

  links[discordUserId] = {
    discordUserId,
    discordUsername,
    steamId: profile.steamId,
    steamPersonaName: profile.personaName,
    steamProfileUrl: profile.profileUrl,
    steamAvatarUrl: profile.avatarUrl,
    visibilityState: profile.visibilityState,
    showCurrentGame: true,
    showInWhoIsGaming: true,
    linkedAt: new Date().toISOString(),
  };

  saveSteamLinks(links);
  return links[discordUserId];
}

function getLinkedSteamAccount(discordUserId) {
  const links = loadSteamLinks();
  return links[discordUserId] || null;
}

function getAllLinkedSteamAccounts() {
  const links = loadSteamLinks();
  return Object.values(links);
}

async function getSteamPresenceForAccounts(accounts) {
  const apiKey = getSteamApiKey();
  const eligibleAccounts = accounts.filter(
    (account) => account && account.steamId && account.showCurrentGame !== false && account.showInWhoIsGaming !== false
  );

  if (!eligibleAccounts.length) {
    return [];
  }

  const steamIds = eligibleAccounts.map((account) => account.steamId).join(",");

  try {
    const response = await axios.get(
      `${STEAM_API_BASE}/ISteamUser/GetPlayerSummaries/v2/`,
      {
        params: {
          key: apiKey,
          steamids: steamIds,
        },
        timeout: 10000,
      }
    );

    const players = response.data?.response?.players || [];
    const playersBySteamId = new Map(players.map((player) => [player.steamid, player]));

    return eligibleAccounts.map((account) => {
      const player = playersBySteamId.get(account.steamId);

      return {
        ...account,
        isOnline: Boolean(player && Number(player.personastate) > 0),
        currentGameName: player?.gameextrainfo || null,
        currentGameId: player?.gameid || null,
        personaState: player?.personastate ?? 0,
        lastLogoff: player?.lastlogoff || null,
      };
    });
  } catch (error) {
    throw new SteamLinkError(
      "Steam presence lookup failed",
      "I couldn't read linked Steam presence right now.",
      error.message
    );
  }
}

function unlinkSteamAccount(discordUserId) {
  const links = loadSteamLinks();
  const existing = links[discordUserId] || null;

  if (!existing) {
    return null;
  }

  delete links[discordUserId];
  saveSteamLinks(links);
  return existing;
}

module.exports = {
  linkSteamAccount,
  getLinkedSteamAccount,
  getAllLinkedSteamAccounts,
  getRecentlyPlayedGames,
  getSteamPresenceForAccounts,
  unlinkSteamAccount,
  SteamLinkError,
};
