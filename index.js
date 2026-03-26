require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { Client, GatewayIntentBits } = require("discord.js");
const {
  getCurrentSpotifyProfile,
  getCurrentPlayback,
  getDevices,
  getOwnedPlaylists,
  startPlaylistPlayback,
  pausePlayback,
  resumePlayback,
  skipToNextTrack,
  skipToPreviousTrack,
  setPlaybackVolume,
} = require("./spotifyService");
const {
  getStore,
  getPreferredDeviceId,
  setPreferredDeviceId,
} = require("./spotifyAccountStore");

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const LOCK_PATH = path.join(__dirname, ".bot.lock");
const PLAYLIST_PAGE_SIZE = 10;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const playlistSelectionCache = new Map();

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function removeProcessLock() {
  try {
    if (!fs.existsSync(LOCK_PATH)) {
      return;
    }

    const lock = JSON.parse(fs.readFileSync(LOCK_PATH, "utf8"));
    if (lock.pid === process.pid) {
      fs.unlinkSync(LOCK_PATH);
    }
  } catch (error) {
    console.error("Failed to remove process lock:", error);
  }
}

function ensureSingleInstance() {
  try {
    if (fs.existsSync(LOCK_PATH)) {
      const existingLock = JSON.parse(fs.readFileSync(LOCK_PATH, "utf8"));
      if (existingLock.pid && isProcessRunning(existingLock.pid)) {
        console.error(
          `Another bot process is already running with PID ${existingLock.pid}. Exiting.`
        );
        process.exit(1);
      }
    }

    fs.writeFileSync(
      LOCK_PATH,
      JSON.stringify(
        {
          pid: process.pid,
          startedAt: new Date().toISOString(),
        },
        null,
        2
      )
    );
  } catch (error) {
    console.error("Failed to create process lock:", error);
    process.exit(1);
  }
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) {
    return "unknown";
  }

  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatPlaylistLine(playlist, index) {
  return `${index + 1}. **${playlist.name}**${playlist.trackCount != null ? ` (${playlist.trackCount} tracks)` : ""}`;
}

function cachePlaylists(message, playlists) {
  playlistSelectionCache.set(message.channel.id, {
    createdAt: Date.now(),
    playlists,
  });
}

function getCachedPlaylists(message) {
  const cached = playlistSelectionCache.get(message.channel.id);
  if (!cached) {
    return [];
  }

  if (Date.now() - cached.createdAt > 15 * 60 * 1000) {
    playlistSelectionCache.delete(message.channel.id);
    return [];
  }

  return cached.playlists;
}

function getRequestedDeviceId() {
  return process.env.SPOTIFY_DEVICE_ID?.trim() || getPreferredDeviceId() || null;
}

async function replyWithPlaylists(message, pageNumber = 1) {
  const playlists = await getOwnedPlaylists();
  cachePlaylists(message, playlists);

  if (!playlists.length) {
    await message.reply("No playlists were found on the connected Spotify account.");
    return;
  }

  const safePage = Math.max(1, pageNumber);
  const totalPages = Math.max(1, Math.ceil(playlists.length / PLAYLIST_PAGE_SIZE));
  const page = Math.min(safePage, totalPages);
  const start = (page - 1) * PLAYLIST_PAGE_SIZE;
  const pageItems = playlists.slice(start, start + PLAYLIST_PAGE_SIZE);

  await message.reply(
    [
      `**Spotify Playlists**`,
      `Page ${page} of ${totalPages}`,
      ...pageItems.map((playlist, index) => formatPlaylistLine(playlist, start + index)),
      "",
      "Use `!play <number>` after `!playlists`, or `!play <playlist name>`.",
    ].join("\n")
  );
}

function findPlaylistFromInput(input, playlists) {
  const trimmed = input.trim();
  const number = Number.parseInt(trimmed, 10);

  if (Number.isInteger(number) && String(number) === trimmed) {
    return playlists[number - 1] || null;
  }

  const exact = playlists.find(
    (playlist) => playlist.name.toLowerCase() === trimmed.toLowerCase()
  );
  if (exact) {
    return exact;
  }

  const partial = playlists.find(
    (playlist) => playlist.name.toLowerCase().includes(trimmed.toLowerCase())
  );
  if (partial) {
    return partial;
  }

  return null;
}

function parseCommand(content, commandName) {
  const match = content.match(new RegExp(`^!${escapeRegExp(commandName)}(?:\\s+(.+))?$`, "i"));
  if (!match) {
    return null;
  }

  return (match[1] || "").trim();
}

async function handlePlayCommand(message, rawInput) {
  if (!rawInput) {
    await message.reply("Provide a playlist name or a playlist number from `!playlists`.");
    return;
  }

  let playlists = getCachedPlaylists(message);
  if (!playlists.length) {
    playlists = await getOwnedPlaylists();
    cachePlaylists(message, playlists);
  }

  const playlist = findPlaylistFromInput(rawInput, playlists);
  if (!playlist) {
    await message.reply("I couldn't find that playlist on the connected Spotify account.");
    return;
  }

  const deviceId = getRequestedDeviceId();
  await startPlaylistPlayback({
    playlistUri: playlist.uri,
    deviceId,
  });

  await message.reply(
    [
      `Starting **${playlist.name}** on Spotify.`,
      playlist.externalUrl ? playlist.externalUrl : null,
      deviceId
        ? `Playback target: \`${deviceId}\``
        : "Playback target: your currently active Spotify device",
    ]
      .filter(Boolean)
      .join("\n")
  );
}

async function handleDevicesCommand(message) {
  const devices = await getDevices();

  if (!devices.length) {
    await message.reply(
      "Spotify returned no available devices. Open Spotify on the target device first so the account has an active Connect target."
    );
    return;
  }

  const preferredDeviceId = getPreferredDeviceId();
  await message.reply(
    [
      "**Spotify Devices**",
      ...devices.map((device, index) => {
        const flags = [];
        if (device.isActive) flags.push("active");
        if (device.id === preferredDeviceId) flags.push("preferred");
        return `${index + 1}. **${device.name}** (${device.type})${flags.length ? ` [${flags.join(", ")}]` : ""}\n   id: \`${device.id}\``;
      }),
    ].join("\n")
  );
}

async function handleSetDeviceCommand(message, rawInput) {
  if (!rawInput) {
    await message.reply("Provide a Spotify device name or device id. Use `!devices` to inspect available devices.");
    return;
  }

  const devices = await getDevices();
  if (!devices.length) {
    await message.reply("No Spotify devices are available right now.");
    return;
  }

  const lowered = rawInput.toLowerCase();
  const selected =
    devices.find((device) => device.id === rawInput) ||
    devices.find((device) => device.name.toLowerCase() === lowered) ||
    devices.find((device) => device.name.toLowerCase().includes(lowered));

  if (!selected) {
    await message.reply("I couldn't match that to a Spotify device.");
    return;
  }

  setPreferredDeviceId(selected.id);
  await message.reply(`Preferred Spotify device set to **${selected.name}** (\`${selected.id}\`).`);
}

async function handleVolumeCommand(message, rawInput) {
  const volume = Number.parseInt(rawInput || "", 10);
  if (!Number.isInteger(volume) || volume < 0 || volume > 100) {
    await message.reply("Provide a volume from 0 to 100. Example: `!volume 65`");
    return;
  }

  await setPlaybackVolume({
    volumePercent: volume,
    deviceId: getRequestedDeviceId(),
  });
  await message.reply(`Spotify volume set to **${volume}%**.`);
}

function buildHelpMessage() {
  return [
    "**Spotify Player Commands**",
    "`!playlists [page]` - list playlists from the connected Spotify account",
    "`!play <number|playlist name>` - start one of those playlists on Spotify",
    "`!spotify` - show current Spotify playback",
    "`!pause` - pause Spotify playback",
    "`!resume` - resume Spotify playback",
    "`!next` - skip to the next track",
    "`!previous` - go back one track",
    "`!devices` - list Spotify Connect devices",
    "`!setdevice <name|id>` - save the default playback device",
    "`!volume <0-100>` - set Spotify volume",
    "`!spotifyaccount` - show the connected Spotify account",
    "`!linkspotify` - reserved for future per-user account linking",
  ].join("\n");
}

ensureSingleInstance();
requireEnv("DISCORD_TOKEN");
requireEnv("SPOTIFY_CLIENT_ID");
requireEnv("SPOTIFY_CLIENT_SECRET");
requireEnv("SPOTIFY_REFRESH_TOKEN");

process.on("exit", removeProcessLock);
process.on("SIGINT", () => {
  removeProcessLock();
  process.exit(0);
});
process.on("SIGTERM", () => {
  removeProcessLock();
  process.exit(0);
});

client.once("clientReady", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  try {
    const profile = await getCurrentSpotifyProfile();
    const store = getStore();
    console.log(
      "Connected Spotify account:",
      JSON.stringify({
        spotifyDisplayName: profile.displayName,
        spotifyUserId: profile.id,
        preferredDeviceId: store.ownerAccount.preferredDeviceId || null,
      })
    );
  } catch (error) {
    console.error("Spotify readiness check failed:", error.message);
  }
});

client.on("messageCreate", async (message) => {
  try {
    if (message.author.bot || !message.guild) {
      return;
    }

    const content = message.content.trim();
    if (!content.startsWith("!")) {
      return;
    }

    if (/^!help$/i.test(content)) {
      await message.reply(buildHelpMessage());
      return;
    }

    if (/^!linkspotify$/i.test(content)) {
      await message.reply(
        "Per-user Spotify linking is not enabled yet. The current bot controls one owner Spotify account, and the storage scaffold is in place for adding linked user accounts later."
      );
      return;
    }

    if (/^!spotifyaccount$/i.test(content)) {
      const profile = await getCurrentSpotifyProfile();
      const preferredDeviceId = getPreferredDeviceId();
      await message.reply(
        [
          `Connected Spotify account: **${profile.displayName || profile.id}**`,
          `Spotify user id: \`${profile.id}\``,
          profile.product ? `Plan: **${profile.product}**` : null,
          preferredDeviceId ? `Preferred device: \`${preferredDeviceId}\`` : "Preferred device: not set",
        ]
          .filter(Boolean)
          .join("\n")
      );
      return;
    }

    if (/^!playlists\b/i.test(content)) {
      const rawPage = parseCommand(content, "playlists");
      const pageNumber = rawPage ? Number.parseInt(rawPage, 10) : 1;
      await replyWithPlaylists(message, Number.isInteger(pageNumber) ? pageNumber : 1);
      return;
    }

    if (/^!play\b/i.test(content)) {
      await handlePlayCommand(message, parseCommand(content, "play"));
      return;
    }

    if (/^!spotify$/i.test(content) || /^!nowplaying$/i.test(content)) {
      const playback = await getCurrentPlayback();
      if (!playback.item) {
        await message.reply("Spotify is not currently playing anything on the connected account.");
        return;
      }

      await message.reply(
        [
          `Now playing: **${playback.item.name}**`,
          playback.item.artists.length ? `Artist: ${playback.item.artists.join(", ")}` : null,
          playback.contextName ? `Context: **${playback.contextName}**` : null,
          `Status: ${playback.isPlaying ? "playing" : "paused"}`,
          `Progress: ${formatDuration(playback.progressMs)} / ${formatDuration(playback.item.durationMs)}`,
          playback.item.externalUrl || null,
        ]
          .filter(Boolean)
          .join("\n")
      );
      return;
    }

    if (/^!pause$/i.test(content)) {
      await pausePlayback({ deviceId: getRequestedDeviceId() });
      await message.reply("Spotify playback paused.");
      return;
    }

    if (/^!resume$/i.test(content)) {
      await resumePlayback({ deviceId: getRequestedDeviceId() });
      await message.reply("Spotify playback resumed.");
      return;
    }

    if (/^!next$/i.test(content)) {
      await skipToNextTrack({ deviceId: getRequestedDeviceId() });
      await message.reply("Skipped to the next Spotify track.");
      return;
    }

    if (/^!previous$/i.test(content)) {
      await skipToPreviousTrack({ deviceId: getRequestedDeviceId() });
      await message.reply("Moved to the previous Spotify track.");
      return;
    }

    if (/^!devices$/i.test(content)) {
      await handleDevicesCommand(message);
      return;
    }

    if (/^!setdevice\b/i.test(content)) {
      await handleSetDeviceCommand(message, parseCommand(content, "setdevice"));
      return;
    }

    if (/^!volume\b/i.test(content)) {
      await handleVolumeCommand(message, parseCommand(content, "volume"));
      return;
    }
  } catch (error) {
    console.error("Command handling failed:", error);
    await message.reply(`Spotify command failed: ${error.message}`).catch(() => {});
  }
});

client.login(DISCORD_TOKEN);
