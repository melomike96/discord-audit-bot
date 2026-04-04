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
  getPlaylistTracks,
} = require("./spotifyService");
const {
  getStore,
  getPreferredDeviceId,
  setPreferredDeviceId,
} = require("./spotifyAccountStore");
const { resolveYoutubeTrackForSpotifyTrack } = require("./youtubeService");
const { enqueueTracks, getNowPlaying, skipTrack, stopPlayback } = require("./discordPlaybackService");
const { addTrackFromUrl, AddTrackError } = require("./audio/library/addTrackService");

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const LOCK_PATH = path.join(__dirname, ".bot.lock");
const COMMAND_HISTORY_PATH = path.join(__dirname, ".command-history.json");
const PLAYLIST_PAGE_SIZE = 10;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const playlistSelectionCache = new Map();

function readCommandHistory() {
  try {
    if (!fs.existsSync(COMMAND_HISTORY_PATH)) {
      return [];
    }

    const parsed = JSON.parse(fs.readFileSync(COMMAND_HISTORY_PATH, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error("Failed to read command history:", error);
    return [];
  }
}

function writeCommandHistory(history) {
  try {
    fs.writeFileSync(COMMAND_HISTORY_PATH, JSON.stringify(history, null, 2));
  } catch (error) {
    console.error("Failed to save command history:", error);
  }
}

function appendCommandHistory(entry) {
  const history = readCommandHistory();
  history.push({
    ...entry,
    createdAt: new Date().toISOString(),
  });
  const maxEntries = Number.parseInt(process.env.COMMAND_HISTORY_LIMIT || "500", 10) || 500;
  writeCommandHistory(history.slice(-maxEntries));
}

async function resolveReplyTarget(message) {
  if (!message.reference?.messageId) {
    return message.id;
  }

  try {
    const originalMessage = await message.fetchReference();
    return originalMessage.id;
  } catch (error) {
    console.warn("Failed to fetch original message reference, replying to command message instead:", error.message);
    return message.id;
  }
}

async function sendReply(message, content) {
  const messageReference = await resolveReplyTarget(message);

  try {
    return await message.channel.send({
      content,
      reply: {
        messageReference,
        failIfNotExists: false,
      },
    });
  } catch (error) {
    console.warn("Reply by message reference failed; falling back to direct channel send:", error.message);
    return message.channel.send({ content });
  }
}

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
    await sendReply(message, "No playlists were found on the connected Spotify account.");
    return;
  }

  const safePage = Math.max(1, pageNumber);
  const totalPages = Math.max(1, Math.ceil(playlists.length / PLAYLIST_PAGE_SIZE));
  const page = Math.min(safePage, totalPages);
  const start = (page - 1) * PLAYLIST_PAGE_SIZE;
  const pageItems = playlists.slice(start, start + PLAYLIST_PAGE_SIZE);

  await sendReply(
    message,
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
    await sendReply(message, "Provide a playlist name or a playlist number from `!playlists`.");
    return;
  }

  let playlists = getCachedPlaylists(message);
  if (!playlists.length) {
    playlists = await getOwnedPlaylists();
    cachePlaylists(message, playlists);
  }

  const playlist = findPlaylistFromInput(rawInput, playlists);
  if (!playlist) {
    await sendReply(message, "I couldn't find that playlist on the connected Spotify account.");
    return;
  }

  const deviceId = getRequestedDeviceId();
  await startPlaylistPlayback({
    playlistUri: playlist.uri,
    deviceId,
  });

  await sendReply(
    message,
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
    await sendReply(
      message,
      "Spotify returned no available devices. Open Spotify on the target device first so the account has an active Connect target."
    );
    return;
  }

  const preferredDeviceId = getPreferredDeviceId();
  await sendReply(
    message,
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
    await sendReply(message, "Provide a Spotify device name or device id. Use `!devices` to inspect available devices.");
    return;
  }

  const devices = await getDevices();
  if (!devices.length) {
    await sendReply(message, "No Spotify devices are available right now.");
    return;
  }

  const lowered = rawInput.toLowerCase();
  const selected =
    devices.find((device) => device.id === rawInput) ||
    devices.find((device) => device.name.toLowerCase() === lowered) ||
    devices.find((device) => device.name.toLowerCase().includes(lowered));

  if (!selected) {
    await sendReply(message, "I couldn't match that to a Spotify device.");
    return;
  }

  setPreferredDeviceId(selected.id);
  await sendReply(message, `Preferred Spotify device set to **${selected.name}** (\`${selected.id}\`).`);
}

async function handleVolumeCommand(message, rawInput) {
  const volume = Number.parseInt(rawInput || "", 10);
  if (!Number.isInteger(volume) || volume < 0 || volume > 100) {
    await sendReply(message, "Provide a volume from 0 to 100. Example: `!volume 65`");
    return;
  }

  await setPlaybackVolume({
    volumePercent: volume,
    deviceId: getRequestedDeviceId(),
  });
  await sendReply(message, `Spotify volume set to **${volume}%**.`);
}

async function resolveSpotifyPlaylistSelection(rawInput, message) {
  let playlists = getCachedPlaylists(message);
  if (!playlists.length) {
    playlists = await getOwnedPlaylists();
    cachePlaylists(message, playlists);
  }

  return findPlaylistFromInput(rawInput, playlists);
}

async function handleDiscordPlayCommand(message, rawInput) {
  if (!rawInput) {
    await sendReply(message, "Provide a playlist name or number from `!playlists`. Example: `!discordplay 1`");
    return;
  }

  const voiceChannel = message.member?.voice?.channel;
  if (!voiceChannel) {
    await sendReply(message, "Join a voice channel first, then run `!discordplay <playlist>`.");
    return;
  }

  const playlist = await resolveSpotifyPlaylistSelection(rawInput, message);
  if (!playlist) {
    await sendReply(message, "I couldn't match that Spotify playlist.");
    return;
  }

  await sendReply(message, `Resolving YouTube audio for **${playlist.name}**. This may take a moment...`);

  const tracks = await getPlaylistTracks(playlist.id);
  if (!tracks.length) {
    await sendReply(message, "That Spotify playlist has no playable tracks.");
    return;
  }

  const maxTracks = Math.min(tracks.length, Number.parseInt(process.env.DISCORD_PLAYLIST_TRACK_LIMIT || "20", 10) || 20);
  const selectedTracks = tracks.slice(0, maxTracks);

  const resolved = [];
  for (const track of selectedTracks) {
    try {
      const youtubeMatch = await resolveYoutubeTrackForSpotifyTrack(track);
      resolved.push({
        ...youtubeMatch,
        spotifyTrack: track,
      });
    } catch (error) {
      console.warn(`Failed to resolve YouTube audio for ${track.name}:`, error.message);
    }
  }

  if (!resolved.length) {
    await sendReply(message, "I couldn't resolve any YouTube sources for that playlist right now.");
    return;
  }

  const queueResult = await enqueueTracks({
    guild: message.guild,
    voiceChannel,
    textChannel: message.channel,
    tracks: resolved,
  });

  await sendReply(message, `Queued **${queueResult.queued}** track(s) from **${playlist.name}** for native Discord playback.`);
}

function classifyDiscordPlayError(error) {
  const message = error?.message || "Unknown error";

  if (/\bstatus 403\b/i.test(message)) {
    return `Spotify playlist lookup failed: ${message}. If this playlist is private or collaborative, refresh the Spotify token with playlist-read-private and playlist-read-collaborative scopes.`;
  }

  if (/yt-dlp|youtube|stream/i.test(message)) {
    return `YouTube resolution failed: ${message}`;
  }

  return `Discord playback setup failed: ${message}`;
}

async function handleAddMusicCommand(message, rawInput) {
  if (!rawInput) {
    await sendReply(message, "Provide a YouTube URL. Example: `!addmusic https://www.youtube.com/watch?v=...`");
    return;
  }

  try {
    const added = await addTrackFromUrl(rawInput, { requestedBy: message.author.tag });
    await sendReply(message, `Added **${added.title}** to the shared repo library.\n${added.canonicalUrl}`);
  } catch (error) {
    if (error instanceof AddTrackError) {
      await sendReply(message, error.userMessage || "Failed to add this track to the library.");
      return;
    }

    throw error;
  }
}

function buildHelpMessage() {
  return [
    "**Spotify + Discord Audio Commands**",
    "`!playlists [page]` - list playlists from the connected Spotify account",
    "`!play <number|playlist name>` - start one of those playlists on Spotify Connect",
    "`!discordplay <number|playlist name>` - play playlist audio natively in your Discord voice channel using YouTube",
    "`!skip` - skip the currently playing Discord voice track",
    "`!stop` - stop Discord voice playback and clear queue",
    "`!nowplaying` - show current Spotify track or active Discord voice track",
    "`!addmusic <youtube url>` - download and add a YouTube track to the shared repo library",
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
      await sendReply(message, buildHelpMessage());
      appendCommandHistory({
        guildId: message.guild.id,
        channelId: message.channel.id,
        authorId: message.author.id,
        command: content,
        status: "ok",
      });
      return;
    }

    if (/^!linkspotify$/i.test(content)) {
      await sendReply(
        message,
        "Per-user Spotify linking is not enabled yet. The current bot controls one owner Spotify account, and the storage scaffold is in place for adding linked user accounts later."
      );
      appendCommandHistory({
        guildId: message.guild.id,
        channelId: message.channel.id,
        authorId: message.author.id,
        command: content,
        status: "ok",
      });
      return;
    }

    if (/^!spotifyaccount$/i.test(content)) {
      const profile = await getCurrentSpotifyProfile();
      const preferredDeviceId = getPreferredDeviceId();
      await sendReply(
        message,
        [
          `Connected Spotify account: **${profile.displayName || profile.id}**`,
          `Spotify user id: \`${profile.id}\``,
          profile.product ? `Plan: **${profile.product}**` : null,
          preferredDeviceId ? `Preferred device: \`${preferredDeviceId}\`` : "Preferred device: not set",
        ]
          .filter(Boolean)
          .join("\n")
      );
      appendCommandHistory({
        guildId: message.guild.id,
        channelId: message.channel.id,
        authorId: message.author.id,
        command: content,
        status: "ok",
      });
      return;
    }

    if (/^!playlists\b/i.test(content)) {
      const rawPage = parseCommand(content, "playlists");
      const pageNumber = rawPage ? Number.parseInt(rawPage, 10) : 1;
      await replyWithPlaylists(message, Number.isInteger(pageNumber) ? pageNumber : 1);
      appendCommandHistory({
        guildId: message.guild.id,
        channelId: message.channel.id,
        authorId: message.author.id,
        command: content,
        status: "ok",
      });
      return;
    }

    if (/^!play\b/i.test(content)) {
      await handlePlayCommand(message, parseCommand(content, "play"));
      appendCommandHistory({
        guildId: message.guild.id,
        channelId: message.channel.id,
        authorId: message.author.id,
        command: content,
        status: "ok",
      });
      return;
    }

    if (/^!discordplay\b/i.test(content)) {
      await handleDiscordPlayCommand(message, parseCommand(content, "discordplay"));
      appendCommandHistory({
        guildId: message.guild.id,
        channelId: message.channel.id,
        authorId: message.author.id,
        command: content,
        status: "ok",
      });
      return;
    }

    if (/^!addmusic\b/i.test(content)) {
      await handleAddMusicCommand(message, parseCommand(content, "addmusic"));
      appendCommandHistory({
        guildId: message.guild.id,
        channelId: message.channel.id,
        authorId: message.author.id,
        command: content,
        status: "ok",
      });
      return;
    }

    if (/^!skip$/i.test(content)) {
      const skipped = skipTrack(message.guild.id);
      await sendReply(message, skipped ? "Skipped current Discord voice track." : "No Discord voice track is active.");
      appendCommandHistory({ guildId: message.guild.id, channelId: message.channel.id, authorId: message.author.id, command: content, status: "ok" });
      return;
    }

    if (/^!stop$/i.test(content)) {
      const stopped = stopPlayback(message.guild.id);
      await sendReply(message, stopped ? "Stopped Discord voice playback and cleared queue." : "No Discord voice session is active.");
      appendCommandHistory({ guildId: message.guild.id, channelId: message.channel.id, authorId: message.author.id, command: content, status: "ok" });
      return;
    }

    if (/^!nowplaying$/i.test(content)) {
      const discordNowPlaying = getNowPlaying(message.guild.id);
      if (discordNowPlaying) {
        await sendReply(message, [`Discord now playing: **${discordNowPlaying.displayTitle}**`, discordNowPlaying.youtubeUrl].join("\n"));
        appendCommandHistory({ guildId: message.guild.id, channelId: message.channel.id, authorId: message.author.id, command: content, status: "ok" });
        return;
      }

      const playback = await getCurrentPlayback();
      if (!playback.item) {
        await sendReply(message, "Nothing is playing right now (Spotify or Discord queue).");
        appendCommandHistory({ guildId: message.guild.id, channelId: message.channel.id, authorId: message.author.id, command: content, status: "ok" });
        return;
      }

      await sendReply(
        message,
        [
          `Spotify now playing: **${playback.item.name}**`,
          playback.item.artists.length ? `Artist: ${playback.item.artists.join(", ")}` : null,
          playback.contextName ? `Context: **${playback.contextName}**` : null,
          `Status: ${playback.isPlaying ? "playing" : "paused"}`,
          `Progress: ${formatDuration(playback.progressMs)} / ${formatDuration(playback.item.durationMs)}`,
          playback.item.externalUrl || null,
        ]
          .filter(Boolean)
          .join("\n")
      );
      appendCommandHistory({ guildId: message.guild.id, channelId: message.channel.id, authorId: message.author.id, command: content, status: "ok" });
      return;
    }

    if (/^!spotify$/i.test(content)) {
      const playback = await getCurrentPlayback();
      if (!playback.item) {
        await sendReply(message, "Spotify is not currently playing anything on the connected account.");
        appendCommandHistory({ guildId: message.guild.id, channelId: message.channel.id, authorId: message.author.id, command: content, status: "ok" });
        return;
      }

      await sendReply(
        message,
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
      appendCommandHistory({ guildId: message.guild.id, channelId: message.channel.id, authorId: message.author.id, command: content, status: "ok" });
      return;
    }

    if (/^!pause$/i.test(content)) {
      await pausePlayback({ deviceId: getRequestedDeviceId() });
      await sendReply(message, "Spotify playback paused.");
      appendCommandHistory({ guildId: message.guild.id, channelId: message.channel.id, authorId: message.author.id, command: content, status: "ok" });
      return;
    }

    if (/^!resume$/i.test(content)) {
      await resumePlayback({ deviceId: getRequestedDeviceId() });
      await sendReply(message, "Spotify playback resumed.");
      appendCommandHistory({ guildId: message.guild.id, channelId: message.channel.id, authorId: message.author.id, command: content, status: "ok" });
      return;
    }

    if (/^!next$/i.test(content)) {
      await skipToNextTrack({ deviceId: getRequestedDeviceId() });
      await sendReply(message, "Skipped to the next Spotify track.");
      appendCommandHistory({ guildId: message.guild.id, channelId: message.channel.id, authorId: message.author.id, command: content, status: "ok" });
      return;
    }

    if (/^!previous$/i.test(content)) {
      await skipToPreviousTrack({ deviceId: getRequestedDeviceId() });
      await sendReply(message, "Moved to the previous Spotify track.");
      appendCommandHistory({ guildId: message.guild.id, channelId: message.channel.id, authorId: message.author.id, command: content, status: "ok" });
      return;
    }

    if (/^!devices$/i.test(content)) {
      await handleDevicesCommand(message);
      appendCommandHistory({ guildId: message.guild.id, channelId: message.channel.id, authorId: message.author.id, command: content, status: "ok" });
      return;
    }

    if (/^!setdevice\b/i.test(content)) {
      await handleSetDeviceCommand(message, parseCommand(content, "setdevice"));
      appendCommandHistory({ guildId: message.guild.id, channelId: message.channel.id, authorId: message.author.id, command: content, status: "ok" });
      return;
    }

    if (/^!volume\b/i.test(content)) {
      await handleVolumeCommand(message, parseCommand(content, "volume"));
      appendCommandHistory({ guildId: message.guild.id, channelId: message.channel.id, authorId: message.author.id, command: content, status: "ok" });
      return;
    }
  } catch (error) {
    console.error("Command handling failed:", error);
    const isDiscordPlayCommand = /^!discordplay\b/i.test(message.content.trim());
    const userMessage = isDiscordPlayCommand
      ? classifyDiscordPlayError(error)
      : `Spotify command failed: ${error.message}`;
    appendCommandHistory({
      guildId: message.guild?.id || null,
      channelId: message.channel?.id || null,
      authorId: message.author?.id || null,
      command: message.content?.trim() || "",
      status: "error",
      errorMessage: error.message,
    });
    await sendReply(message, userMessage).catch(() => {});
  }
});

client.login(DISCORD_TOKEN);
