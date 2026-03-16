require("dotenv").config();

console.log("===== BOT STARTING =====");

const fs = require("fs");
const path = require("path");
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  StringSelectMenuBuilder,
} = require("discord.js");

const {
  addTrackFromUrl,
  AddTrackError,
  getYtDlpConfigSummary,
  hydrateLibraryFromGithub,
} = require("./audio/library/addTrackService");
const {
  linkSteamAccount,
  getLinkedSteamAccount,
  getAllLinkedSteamAccounts,
  getRecentlyPlayedGames,
  getSteamPresenceForAccounts,
  unlinkSteamAccount,
  SteamLinkError,
} = require("./steamLinkService");
const { resolveCommand } = require("./audio/library/resolveCommand");

const {
  startLoungeSession,
  stopLoungeSession,
  skipCurrentTrack,
  getCurrentTrack,
  getLibraryTracks,
  getRecentTrackHistory,
  hasActiveSession,
  requestTrackPlayback,
  setRadioLifecycleHandlers,
  state: radioState,
} = require("./radio");
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const GENERAL_CHANNEL_ID = process.env.GENERAL_CHANNEL_ID;
const LOUNGE_VOICE_CHANNEL_ID = process.env.LOUNGE_VOICE_CHANNEL_ID;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;
const PRIVATE_VOICE_CHANNEL_ID = process.env.PRIVATE_VOICE_CHANNEL_ID;
const LOCK_PATH = path.join(__dirname, ".bot.lock");
const LOUNGE_STATUS_PATH = path.join(__dirname, ".lounge-status.json");
const STEAM_STATUS_PATH = path.join(__dirname, ".steam-status.json");
const BOT_METRICS_PATH = path.join(__dirname, ".bot-metrics.json");
const LIBRARY_PAGE_SIZE = 10;
const STATION_NAME = "Melo Lounge FM";
const STATION_ACCENT = 0xc08457;
const STATION_ALT_ACCENT = 0x57f287;
const STATION_MANUAL_ACCENT = 0xf59e0b;
const LOCAL_YT_DLP_CANDIDATES = [
  path.join(__dirname, ".runtime", "bin", process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp"),
  path.join(__dirname, ".render", "bin", "yt-dlp"),
];

console.log("Loaded ENV:");
console.log("GENERAL_CHANNEL_ID:", GENERAL_CHANNEL_ID || "(not set)");
console.log("LOUNGE_VOICE_CHANNEL_ID:", LOUNGE_VOICE_CHANNEL_ID || "(not set)");
console.log("LOG_CHANNEL_ID:", LOG_CHANNEL_ID || "(not set)");
console.log("PRIVATE_VOICE_CHANNEL_ID:", PRIVATE_VOICE_CHANNEL_ID || "(not set)");

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
    if (!fs.existsSync(LOCK_PATH)) return;

    const lock = JSON.parse(fs.readFileSync(LOCK_PATH, "utf8"));
    if (lock.pid === process.pid) {
      fs.unlinkSync(LOCK_PATH);
    }
  } catch (err) {
    console.error("Failed to remove process lock:", err);
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
  } catch (err) {
    console.error("Failed to create process lock:", err);
    process.exit(1);
  }
}

ensureSingleInstance();

if (!resolveCommand(["yt-dlp", "yt_dlp"], {
  envVar: "YT_DLP_PATH",
  paths: LOCAL_YT_DLP_CANDIDATES,
})) {
  console.warn("WARNING: yt-dlp is not installed. `!addtrack` will not work until it is installed and available on PATH.");
} else {
  const ytDlpConfig = getYtDlpConfigSummary();
  console.log("yt-dlp config:", ytDlpConfig);
}

process.on("exit", removeProcessLock);
process.on("SIGINT", () => {
  removeProcessLock();
  process.exit(0);
});
process.on("SIGTERM", () => {
  removeProcessLock();
  process.exit(0);
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

async function sendToGeneral(guild, content) {
  try {
    if (!GENERAL_CHANNEL_ID) {
      console.log("GENERAL_CHANNEL_ID missing, skipping general message.");
      return;
    }

    const channel = await guild.channels.fetch(GENERAL_CHANNEL_ID).catch(() => null);

    if (!channel) {
      console.log("General channel not found.");
      return;
    }

    if (!channel.isTextBased()) {
      console.log("GENERAL_CHANNEL_ID is not a text channel.");
      return;
    }

    await channel.send({
      content,
      allowedMentions: { parse: [] },
    });

    console.log("Message sent to general.");
  } catch (err) {
    console.error("sendToGeneral failed:", err);
  }
}

client.once("clientReady", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log("===== BOT READY =====");
  for (const guild of client.guilds.cache.values()) {
    updateLoungeStatusMessage(guild).catch((error) => {
      console.error("Initial lounge status update failed:", error);
    });
    updateSteamStatusMessage(guild).catch((error) => {
      console.error("Initial steam status update failed:", error);
    });
  }
});


setRadioLifecycleHandlers({
  trackStart: async ({ track, guildId, isManualRequest }) => {
    try {
      const guild = client.guilds.cache.get(guildId)
        || await client.guilds.fetch(guildId).catch(() => null);
      if (!guild) {
        return;
      }

      await sendEmbedToLog(guild, buildNowPlayingEmbed(track, { isManualRequest }));
      await maybeSendTrackPlayMilestone(guild, track);
      await updateLoungeStatusMessage(guild, `Now playing: ${track.title || track.name}`);
    } catch (error) {
      console.error("trackStart handler failed:", error);
    }
  },
  trackEnd: async ({ track, guildId, wasSkipped }) => {
    try {
      const guild = client.guilds.cache.get(guildId)
        || await client.guilds.fetch(guildId).catch(() => null);
      if (!guild) {
        return;
      }

      await updateLoungeStatusMessage(
        guild,
        wasSkipped
          ? `Track skipped: ${track.title || track.name}`
          : `Track ended: ${track.title || track.name}`
      );
    } catch (error) {
      console.error("trackEnd handler failed:", error);
    }
  },
});

function parseAddTrackCommand(content) {
  const match = content.match(/^!addtrack\s+(.+)$/i);
  if (!match) return null;

  return match[1].trim();
}

function parseLinkSteamCommand(content) {
  const match = content.match(/^!linksteam\s+(.+)$/i);
  if (!match) return null;

  return match[1].trim();
}

function isYoutubeUrl(value) {
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();

    return (
      host === "youtube.com" ||
      host.endsWith(".youtube.com") ||
      host === "youtu.be" ||
      host.endsWith(".youtu.be")
    );
  } catch {
    return false;
  }
}

async function sendToLog(guild, content) {
  try {
    if (!LOG_CHANNEL_ID) {
      console.log("LOG_CHANNEL_ID missing, skipping log channel message.");
      return;
    }

    const channel = await guild.channels.fetch(LOG_CHANNEL_ID).catch(() => null);

    if (!channel) {
      console.log("Log channel not found.");
      return;
    }

    if (!channel.isTextBased()) {
      console.log("LOG_CHANNEL_ID is not a text channel.");
      return;
    }

    await channel.send({
      content,
      allowedMentions: { parse: [] },
    });

    console.log("Message sent to log channel.");
  } catch (err) {
    console.error("sendToLog failed:", err);
  }
}

function readLoungeStatusState() {
  try {
    if (!fs.existsSync(LOUNGE_STATUS_PATH)) {
      return {};
    }

    return JSON.parse(fs.readFileSync(LOUNGE_STATUS_PATH, "utf8"));
  } catch (error) {
    console.error("Failed to read lounge status state:", error);
    return {};
  }
}

function readBotMetrics() {
  try {
    if (!fs.existsSync(BOT_METRICS_PATH)) {
      return {
        milestones: {
          libraryTrackCount: 0,
        },
        trackPlayCounts: {},
      };
    }

    const parsed = JSON.parse(fs.readFileSync(BOT_METRICS_PATH, "utf8"));
    return {
      milestones: {
        libraryTrackCount: Number(parsed?.milestones?.libraryTrackCount) || 0,
      },
      trackPlayCounts:
        parsed?.trackPlayCounts && typeof parsed.trackPlayCounts === "object"
          ? parsed.trackPlayCounts
          : {},
    };
  } catch (error) {
    console.error("Failed to read bot metrics:", error);
    return {
      milestones: {
        libraryTrackCount: 0,
      },
      trackPlayCounts: {},
    };
  }
}

function writeBotMetrics(metrics) {
  try {
    fs.writeFileSync(BOT_METRICS_PATH, `${JSON.stringify(metrics, null, 2)}\n`, "utf8");
  } catch (error) {
    console.error("Failed to write bot metrics:", error);
  }
}

function getLibraryMilestoneTarget(trackCount) {
  if (trackCount < 10) return null;

  if (trackCount < 100) {
    return Math.floor(trackCount / 10) * 10;
  }

  return Math.floor(trackCount / 25) * 25;
}

function formatDuration(durationSeconds) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return "Unknown";
  }

  const totalSeconds = Math.floor(durationSeconds);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (hours > 0) {
    return `${hours}:${String(remainingMinutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatRelativeDate(value) {
  if (!value) {
    return "Unknown";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

function buildStationEmbed({ title, description, color = STATION_ACCENT, footer = null }) {
  const embed = new EmbedBuilder()
    .setAuthor({
      name: STATION_NAME,
    })
    .setTitle(title)
    .setDescription(description)
    .setColor(color)
    .setTimestamp(new Date());

  if (footer) {
    embed.setFooter({ text: footer });
  }

  return embed;
}

async function getLogTextChannel(guild) {
  if (!LOG_CHANNEL_ID) {
    console.log("LOG_CHANNEL_ID missing, skipping log embed.");
    return null;
  }

  const channel = await guild.channels.fetch(LOG_CHANNEL_ID).catch(() => null);

  if (!channel) {
    console.log("Log channel not found.");
    return null;
  }

  if (!channel.isTextBased()) {
    console.log("LOG_CHANNEL_ID is not a text channel.");
    return null;
  }

  return channel;
}

async function sendEmbedToLog(guild, embed) {
  try {
    const channel = await getLogTextChannel(guild);
    if (!channel) {
      return;
    }

    await channel.send({
      embeds: [embed],
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    console.error("sendEmbedToLog failed:", error);
  }
}

function buildNowPlayingEmbed(track, { isManualRequest = false } = {}) {
  const accentColor = isManualRequest ? STATION_MANUAL_ACCENT : STATION_ALT_ACCENT;
  const footerText = isManualRequest
    ? `Manual pick${track.queuedBy ? ` queued by ${track.queuedBy}` : ""}${track.requestedBy ? ` | library add by ${track.requestedBy}` : ""}`
    : track.requestedBy
      ? `Library add by ${track.requestedBy}`
      : "Automated lounge rotation";
  const embed = buildStationEmbed({
    title: isManualRequest ? "Now Playing" : "On Air Now",
    description: `**${track.title || track.name}**`,
    color: accentColor,
    footer: footerText,
  })
    .addFields(
      {
        name: "Artist / Uploader",
        value: track.uploader || "Unknown",
        inline: true,
      },
      {
        name: "Duration",
        value: formatDuration(track.durationSeconds),
        inline: true,
      },
      {
        name: "Source",
        value: track.sourceUrl ? `[Open track](${track.sourceUrl})` : "Library file",
        inline: true,
      },
      {
        name: "Added",
        value: formatRelativeDate(track.addedAt),
        inline: true,
      }
    );

  return embed;
}

function buildUpNextEmbed(track, requestedBy) {
  return buildStationEmbed({
    title: "Up Next",
    description: `**${track.title || track.name}** is queued ${requestedBy ? `by **${requestedBy}**` : "from the library menu"}.`,
    color: STATION_MANUAL_ACCENT,
    footer: track.requestedBy ? `Library add by ${track.requestedBy}` : "Manual lounge selection",
  }).addFields(
    {
      name: "Artist / Uploader",
      value: track.uploader || "Unknown",
      inline: true,
    },
    {
      name: "Duration",
      value: formatDuration(track.durationSeconds),
      inline: true,
    },
    {
      name: "Source",
      value: track.sourceUrl ? `[Open track](${track.sourceUrl})` : "Library file",
      inline: true,
    }
  );
}

function buildMilestoneEmbed({ title, description, color = 0x5865f2, footer = null }) {
  return buildStationEmbed({ title, description, color, footer });
}

function buildRecentHistoryEmbed() {
  const recentTracks = getRecentTrackHistory();
  const description = recentTracks.length
    ? recentTracks
        .slice(0, 5)
        .map((track, index) => {
          const queueMarker = track.queuedBy ? ` [queued by ${track.queuedBy}]` : "";
          return `${index + 1}. **${track.title || track.name}**${track.uploader ? ` - ${track.uploader}` : ""}${queueMarker}`;
        })
        .join("\n")
    : "No spins recorded yet this session.";

  return buildStationEmbed({
    title: "Recent Spins",
    description,
    color: STATION_ACCENT,
    footer: recentTracks[0]?.playedAt ? `Latest spin ${formatRelativeDate(recentTracks[0].playedAt)}` : "Spin history starts when radio plays",
  });
}

async function maybeSendLibraryMilestone(guild, addedTrack) {
  const trackCount = getLibraryTracks().length;
  const nextMilestone = getLibraryMilestoneTarget(trackCount);
  if (!nextMilestone || nextMilestone !== trackCount) {
    return;
  }

  const metrics = readBotMetrics();
  if (metrics.milestones.libraryTrackCount >= nextMilestone) {
    return;
  }

  metrics.milestones.libraryTrackCount = nextMilestone;
  writeBotMetrics(metrics);

  await sendEmbedToLog(
    guild,
    buildMilestoneEmbed({
      title: "Library Milestone",
      description: `The lounge library just hit **${nextMilestone} tracks**.\nLatest add: **${addedTrack.title}**${addedTrack.uploader ? ` by **${addedTrack.uploader}**` : ""}.`,
      color: 0x5865f2,
      footer: addedTrack.requestedBy ? `Requested by ${addedTrack.requestedBy}` : "Fresh pull for the crates",
    })
  );
}

async function maybeSendTrackPlayMilestone(guild, track) {
  const metrics = readBotMetrics();
  const key = track.fileName;
  const currentCount = (Number(metrics.trackPlayCounts[key]) || 0) + 1;
  metrics.trackPlayCounts[key] = currentCount;
  writeBotMetrics(metrics);

  if (currentCount < 5 || currentCount % 25 !== 0) {
    return;
  }

  await sendEmbedToLog(
    guild,
    buildMilestoneEmbed({
      title: "Track Milestone",
      description: `**${track.title || track.name}** just spun for the **${currentCount}th** time.`,
      color: 0xec4899,
      footer: track.uploader ? `Uploader: ${track.uploader}` : "Certified lounge rotation",
    })
  );
}

function writeLoungeStatusState(state) {
  try {
    fs.writeFileSync(LOUNGE_STATUS_PATH, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  } catch (error) {
    console.error("Failed to write lounge status state:", error);
  }
}

function readSteamStatusState() {
  try {
    if (!fs.existsSync(STEAM_STATUS_PATH)) {
      return {};
    }

    return JSON.parse(fs.readFileSync(STEAM_STATUS_PATH, "utf8"));
  } catch (error) {
    console.error("Failed to read steam status state:", error);
    return {};
  }
}

function writeSteamStatusState(state) {
  try {
    fs.writeFileSync(STEAM_STATUS_PATH, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  } catch (error) {
    console.error("Failed to write steam status state:", error);
  }
}

function formatTimestamp(date = new Date()) {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

function formatSteamHours(minutes) {
  return `${((Number(minutes) || 0) / 60).toFixed(1)}h`;
}

function buildWhoIsGamingEmbed(presenceEntries) {
  const activePlayers = presenceEntries.filter((entry) => entry.currentGameName);
  const onlineNoGame = presenceEntries.filter((entry) => entry.isOnline && !entry.currentGameName);
  const groupedGames = new Map();

  for (const entry of activePlayers) {
    const current = groupedGames.get(entry.currentGameName) || [];
    current.push(entry.discordUsername || entry.steamPersonaName);
    groupedGames.set(entry.currentGameName, current);
  }

  const activeLines = activePlayers.length
    ? [...groupedGames.entries()]
        .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
        .map(([gameName, players]) => `**${gameName}**\n${players.join(", ")}`)
        .join("\n\n")
    : "No linked members are in a Steam game right now.";

  const embed = buildStationEmbed({
    title: "Who's Gaming",
    description: activeLines,
    color: activePlayers.length ? 0x1b2838 : 0x747f8d,
    footer: `${activePlayers.length} in-game | ${onlineNoGame.length} online | ${presenceEntries.length} linked`,
  });

  if (onlineNoGame.length) {
    embed.addFields({
      name: "Online on Steam",
      value: onlineNoGame
        .map((entry) => entry.discordUsername || entry.steamPersonaName)
        .join(", ")
        .slice(0, 1024),
      inline: false,
    });
  }

  return embed;
}

async function getOrCreateSteamStatusMessage(guild) {
  const channel = await getLogTextChannel(guild);
  if (!channel) {
    return null;
  }

  const state = readSteamStatusState();
  const existingMessageId = state[guild.id];

  if (existingMessageId) {
    const existingMessage = await channel.messages.fetch(existingMessageId).catch(() => null);
    if (existingMessage) {
      return existingMessage;
    }
  }

  const createdMessage = await channel.send({
    embeds: [
      buildStationEmbed({
        title: "Who's Gaming",
        description: "Initializing Steam activity...",
        color: 0x1b2838,
      }),
    ],
    allowedMentions: { parse: [] },
  });

  writeSteamStatusState({
    ...state,
    [guild.id]: createdMessage.id,
  });

  return createdMessage;
}

async function updateSteamStatusMessage(guild) {
  try {
    const linkedAccounts = getAllLinkedSteamAccounts();
    const statusMessage = await getOrCreateSteamStatusMessage(guild);

    if (!statusMessage) {
      return { updated: false, reason: "missing_channel" };
    }

    if (!linkedAccounts.length) {
      await statusMessage.edit({
        embeds: [
          buildStationEmbed({
            title: "Who's Gaming",
            description: "No Steam accounts are linked yet.",
            color: 0x747f8d,
            footer: "Use !linksteam to get started",
          }),
        ],
        allowedMentions: { parse: [] },
      });

      return { updated: true, linkedCount: 0, activeCount: 0 };
    }

    const presenceEntries = await getSteamPresenceForAccounts(linkedAccounts);
    const activeCount = presenceEntries.filter((entry) => entry.currentGameName).length;

    await statusMessage.edit({
      embeds: [buildWhoIsGamingEmbed(presenceEntries)],
      allowedMentions: { parse: [] },
    });

    return {
      updated: true,
      linkedCount: presenceEntries.length,
      activeCount,
    };
  } catch (error) {
    if (error instanceof SteamLinkError) {
      console.error("Steam status update failed:", error.message, error.details || "");
      return { updated: false, reason: error.userMessage };
    }

    console.error("Steam status update unexpected failure:", error);
    return { updated: false, reason: "unexpected_error" };
  }
}

function getTrackedLoungeChannelId() {
  return PRIVATE_VOICE_CHANNEL_ID || radioState.activeChannelId || LOUNGE_VOICE_CHANNEL_ID || null;
}

function getTrackedChannelBaseName(channel) {
  if (!channel?.name) {
    return "hardcore loungin";
  }

  return channel.name.replace(/\s+[|•]\s+.*$/i, "");
}

function truncateChannelStatusSegment(value, maxLength = 32) {
  if (typeof value !== "string") {
    return "";
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function buildTrackedVoiceChannelName(channel, memberCount, currentTrack) {
  const baseName = getTrackedChannelBaseName(channel);
  const statusSegments = [hasActiveSession() ? "live" : "idle"];

  if (Number.isFinite(memberCount)) {
    statusSegments.push(`${memberCount} in room`);
  }

  if (hasActiveSession()) {
    const trackLabel = truncateChannelStatusSegment(currentTrack?.title || currentTrack?.name, 36);
    if (trackLabel) {
      statusSegments.push(trackLabel);
    }
  }

  const nextName = `${baseName} | ${statusSegments.join(" | ")}`;
  return nextName.length <= 100
    ? nextName
    : truncateChannelStatusSegment(nextName, 100);
}

async function updateTrackedVoiceChannelStatus(guild, voiceChannel, memberCount, currentTrack) {
  if (!voiceChannel?.manageable) {
    return;
  }

  const nextName = buildTrackedVoiceChannelName(voiceChannel, memberCount, currentTrack);
  if (voiceChannel.name === nextName) {
    return;
  }

  try {
    await voiceChannel.setName(nextName, "Sync private lounge tracker");
  } catch (error) {
    console.error("Failed to update tracked voice channel name:", error);
  }
}

async function getStatusTextChannel(guild) {
  const trackedChannelId = getTrackedLoungeChannelId();
  if (!trackedChannelId) {
    return null;
  }

  const channel = await guild.channels.fetch(trackedChannelId).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    return null;
  }

  return channel;
}

async function getOrCreateLoungeStatusMessage(guild) {
  const channel = await getStatusTextChannel(guild);
  if (!channel) {
    return null;
  }

  const state = readLoungeStatusState();
  const existingMessageId = state[guild.id];

  if (existingMessageId) {
    const existingMessage = await channel.messages.fetch(existingMessageId).catch(() => null);
    if (existingMessage) {
      return existingMessage;
    }
  }

  const createdMessage = await channel.send({
    content: null,
    embeds: [
      new EmbedBuilder()
        .setTitle("Casual Loungin'")
        .setDescription("Initializing lounge status...")
        .setColor(0x5865f2),
    ],
    allowedMentions: { parse: [] },
  });

  writeLoungeStatusState({
    ...state,
    [guild.id]: createdMessage.id,
  });

  return createdMessage;
}

async function updateLoungeStatusMessage(guild, recentActivity = null) {
  const trackedChannelId = getTrackedLoungeChannelId();
  if (!trackedChannelId) {
    return;
  }

  const loungeChannel = await guild.channels.fetch(trackedChannelId).catch(() => null);
  if (!loungeChannel || !("members" in loungeChannel)) {
    console.log("Lounge voice channel not found for status update.");
    return;
  }

  const memberNames = [...loungeChannel.members.values()]
    .filter((member) => !member.user.bot)
    .map((member) => member.displayName || member.user.username)
    .sort((a, b) => a.localeCompare(b));
  const loungeName = getTrackedChannelBaseName(loungeChannel);
  const currentTrack = getCurrentTrack();

  await updateTrackedVoiceChannelStatus(guild, loungeChannel, memberNames.length, currentTrack);

  const embed = new EmbedBuilder()
    .setTitle(loungeName)
    .setColor(memberNames.length ? 0x57f287 : 0x747f8d)
    .addFields(
      {
        name: `Currently Loungin' (${memberNames.length})`,
        value: memberNames.length ? memberNames.join("\n") : "Nobody in the channel",
        inline: false,
      },
      {
        name: "Radio",
        value: hasActiveSession() ? "Active" : "Inactive",
        inline: true,
      },
      {
        name: "Now Playing",
        value: currentTrack?.title || currentTrack?.name || "Nothing live right now",
        inline: true,
      },
      {
        name: "Last Update",
        value: formatTimestamp(),
        inline: false,
      }
    )
    .setFooter({
      text: recentActivity || "Watching for lounge activity",
    });

  const statusMessage = await getOrCreateLoungeStatusMessage(guild);
  if (!statusMessage) {
    return;
  }

  await statusMessage.edit({
    content: null,
    embeds: [embed],
    allowedMentions: { parse: [] },
  });
}

async function announceLoungePresenceTransition(guild, transition) {
  if (transition.type === "active") {
    await sendEmbedToLog(
      guild,
      buildMilestoneEmbed({
        title: "Lounge Active",
        description: `**${transition.memberName}** just lit up hardcore loungin.`,
        color: 0x57f287,
        footer: transition.headcount === 1 ? "The room is open" : `${transition.headcount} people in the room`,
      })
    );
    return;
  }

  if (transition.type === "empty") {
    await sendEmbedToLog(
      guild,
      buildMilestoneEmbed({
        title: "Lounge Empty",
        description: `**${transition.memberName}** was the last one out of hardcore loungin.`,
        color: 0x747f8d,
        footer: "The room went quiet",
      })
    );
  }
}

function clampLibraryPage(page, totalTracks) {
  const totalPages = Math.max(1, Math.ceil(totalTracks / LIBRARY_PAGE_SIZE));
  return Math.min(Math.max(page, 0), totalPages - 1);
}

function truncateForOption(value, maxLength = 100) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}

function buildLibraryMessage(page = 0) {
  const tracks = getLibraryTracks();
  const safePage = clampLibraryPage(page, tracks.length);
  const start = safePage * LIBRARY_PAGE_SIZE;
  const visibleTracks = tracks.slice(start, start + LIBRARY_PAGE_SIZE);
  const currentTrack = getCurrentTrack();
  const totalPages = Math.max(1, Math.ceil(tracks.length / LIBRARY_PAGE_SIZE));

  const embed = new EmbedBuilder()
    .setTitle(`Lounge Library (${tracks.length})`)
    .setDescription(
      visibleTracks.length
        ? visibleTracks
            .map((track, index) => {
              const absoluteIndex = start + index + 1;
              const marker = currentTrack?.fileName === track.fileName ? " [playing]" : "";
              return `${absoluteIndex}. ${track.name}${marker}`;
            })
            .join("\n")
        : "Library is currently empty."
    )
    .setFooter({ text: `Page ${safePage + 1} of ${totalPages}` });

  const components = [];

  if (visibleTracks.length) {
    components.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`library:select:${safePage}`)
          .setPlaceholder("Choose a track to play next")
          .addOptions(
            visibleTracks.map((track) => ({
              label: truncateForOption(track.name),
              value: track.fileName,
              description: truncateForOption(track.fileName, 100),
            }))
          )
      )
    );
  }

  components.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`library:page:${safePage - 1}`)
        .setLabel("Previous")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(safePage === 0),
      new ButtonBuilder()
        .setCustomId(`library:page:${safePage + 1}`)
        .setLabel("Next")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(safePage >= totalPages - 1),
      new ButtonBuilder()
        .setCustomId(`library:refresh:${safePage}`)
        .setLabel("Refresh")
        .setStyle(ButtonStyle.Primary)
    )
  );

  return {
    embeds: [embed],
    components,
  };
}

client.on("messageCreate", async (message) => {
  try {
    if (message.author.bot || !message.guild) return;

    const content = message.content.trim();

    if (content === "!start") {
      const voiceChannel = message.member?.voice?.channel;

      if (!voiceChannel) {
        await message.reply("Join a voice channel first.");
        return;
      }

      if (hasActiveSession()) {
        await message.reply("Radio is already running.");
        return;
      }

      const introPath = path.join(__dirname, "audio", "sounds", "loungin_join.wav");

      console.log(`!start received from ${message.author.username} in ${voiceChannel.name}`);

      await message.reply(`DJ Loungin' has started spinnin in **${voiceChannel.name}**.`);

      startLoungeSession({
        guild: message.guild,
        voiceChannel,
        introPath,
      });
      await updateLoungeStatusMessage(message.guild, `Radio started in ${voiceChannel.name}`);

      return;
    }

    if (content === "!stop") {
      console.log(`!stop received from ${message.author.username}`);
      stopLoungeSession();
      await updateLoungeStatusMessage(message.guild, "Radio stop requested");
      await message.reply("DJ Loungin' has been booed off stage.");
      return;
    }

    if (content === "!skip") {
      console.log(`!skip received from ${message.author.username}`);
      const skipped = skipCurrentTrack();
      await message.reply(
        skipped
          ? `Skipping **${skipped}**.`
          : "Nothing to skip."
      );
      return;
    }

    if (content === "!track") {
      console.log(`!track received from ${message.author.username}`);
      const track = getCurrentTrack();
      await message.reply(
        track
          ? {
              embeds: [buildNowPlayingEmbed(track, { isManualRequest: Boolean(track.queuedBy) })],
            }
          : "Nothing playing right now."
      );
      return;
    }

    if (content === "!recent" || content === "!history") {
      console.log(`!recent received from ${message.author.username}`);
      await message.reply({
        embeds: [buildRecentHistoryEmbed()],
      });
      return;
    }

    if (content === "!library" || content === "/library") {
      console.log(`!library received from ${message.author.username}`);
      await message.reply(buildLibraryMessage(0));
      return;
    }

    if (content === "!whoson" || content === "!gaming" || content === "!steamnow") {
      console.log(`!whoson received from ${message.author.username}`);

      try {
        const result = await updateSteamStatusMessage(message.guild);

        if (!result.updated) {
          await message.reply(
            typeof result.reason === "string"
              ? `Couldn't refresh the Steam status card: ${result.reason}`
              : "Couldn't refresh the Steam status card right now."
          );
          return;
        }

        await message.reply(
          result.linkedCount
            ? `Updated the Steam status card in logs. Active players: **${result.activeCount}** / linked: **${result.linkedCount}**.`
            : "Updated the Steam status card in logs. No linked Steam accounts yet."
        );
      } catch (error) {
        if (error instanceof SteamLinkError) {
          console.error("whoson failed:", error.message, error.details || "");
          await message.reply(`❌ ${error.userMessage}`);
        } else {
          console.error("whoson unexpected failure:", error);
          await message.reply("❌ Couldn't read Steam activity right now.");
        }
      }

      return;
    }

    if (/^!linksteam\b/i.test(content) && !parseLinkSteamCommand(content)) {
      await message.reply("Provide a Steam profile URL, custom URL, or SteamID64. Example: `!linksteam https://steamcommunity.com/id/yourname`");
      return;
    }

    const linkSteamInput = parseLinkSteamCommand(content);
    if (linkSteamInput) {
      console.log(`!linksteam received from ${message.author.username}`);

      try {
        const linked = await linkSteamAccount({
          discordUserId: message.author.id,
          discordUsername: message.author.username,
          input: linkSteamInput,
        });

        const visibilityNote = linked.visibilityState >= 3
          ? "Steam profile resolved successfully."
          : "Steam profile resolved, but some game presence data may stay hidden if the profile is private.";

        await message.reply(
          [
            `Linked Steam account: **${linked.steamPersonaName}**`,
            linked.steamProfileUrl,
            visibilityNote,
          ].join("\n")
        );
      } catch (error) {
        if (error instanceof SteamLinkError) {
          console.error("linkSteam failed:", error.message, error.details || "");
          await message.reply(`❌ ${error.userMessage}`);
        } else {
          console.error("linkSteam unexpected failure:", error);
          await message.reply("❌ Couldn't link that Steam account right now.");
        }
      }

      return;
    }

    if (content === "!mysteam") {
      console.log(`!mysteam received from ${message.author.username}`);
      const linked = getLinkedSteamAccount(message.author.id);

      if (!linked) {
        await message.reply("You don't have a linked Steam account yet. Use `!linksteam <profileUrl>` first.");
        return;
      }

      try {
        const recentGames = await getRecentlyPlayedGames(linked.steamId, 5);
        const recentGamesText = recentGames.length
          ? recentGames
              .map((game, index) => {
                const lastTwoWeeks = formatSteamHours(game.playtime_2weeks);
                const total = formatSteamHours(game.playtime_forever);
                return `${index + 1}. **${game.name}** - ${lastTwoWeeks} last 2 weeks, ${total} total`;
              })
              .join("\n")
          : "No recent Steam games available.";

        const embed = buildStationEmbed({
          title: "My Steam",
          description: `**${linked.steamPersonaName}**\n${linked.steamProfileUrl}`,
          color: 0x1b2838,
          footer: linked.visibilityState >= 3 ? "Steam link active" : "Steam profile may be private",
        }).addFields({
          name: "Recently Played",
          value: recentGamesText.slice(0, 1024),
          inline: false,
        });

        await message.reply({
          embeds: [embed],
        });
      } catch (error) {
        if (error instanceof SteamLinkError) {
          console.error("mysteam failed:", error.message, error.details || "");
          await message.reply(
            [
              `Linked Steam account: **${linked.steamPersonaName}**`,
              linked.steamProfileUrl,
              `Recent games unavailable: ${error.userMessage}`,
            ].join("\n")
          );
        } else {
          console.error("mysteam unexpected failure:", error);
          await message.reply(
            [
              `Linked Steam account: **${linked.steamPersonaName}**`,
              linked.steamProfileUrl,
            ].join("\n")
          );
        }
      }
      return;
    }

    if (content === "!unlinksteam") {
      console.log(`!unlinksteam received from ${message.author.username}`);
      const removed = unlinkSteamAccount(message.author.id);

      await message.reply(
        removed
          ? `Unlinked Steam account **${removed.steamPersonaName}**.`
          : "You don't have a linked Steam account to remove."
      );
      return;
    }

    if (
      content === "!librarysync" ||
      content === "!syncLibrary" ||
      content === "!refreshlibrary" ||
      content === "/librarysync"
    ) {
      console.log(`!librarysync received from ${message.author.username}`);
      await message.reply("🔄 Syncing lounge library from GitHub...");

      try {
        const hydrationResult = await hydrateLibraryFromGithub();

        if (!hydrationResult.hydrated) {
          const reasonMessage = hydrationResult.reason === "disabled"
            ? "Library sync is currently disabled for this bot instance."
            : `Library sync skipped (${hydrationResult.reason || "unknown reason"}).`;

          await message.reply(`⚠️ ${reasonMessage}`);
          return;
        }

        const tracks = getLibraryTracks();

        await message.reply(
          [
            "✅ Library sync complete.",
            `Downloaded missing tracks: **${hydrationResult.downloadedTracks || 0}**`,
            `Ready tracks available: **${tracks.length}**`,
          ].join("\n")
        );
      } catch (error) {
        console.error("Library sync command failed:", error);
        await message.reply("❌ Library sync failed. Please try again in a bit.");
      }

      return;
    }

    if (/^!addtrack\b/i.test(content) && !parseAddTrackCommand(content)) {
      await message.reply("Please provide a YouTube link. Example: `!addtrack https://www.youtube.com/watch?v=dQw4w9WgXcQ`");
      return;
    }

    const addTrackUrl = parseAddTrackCommand(content);
    if (addTrackUrl) {
      console.log(`!addtrack received from ${message.author.username}`);

      if (!isYoutubeUrl(addTrackUrl)) {
        await message.reply("That doesn't look like a valid YouTube link. Please use a `youtube.com` or `youtu.be` URL.");
        return;
      }

      await message.reply("🎧 Got it — processing your YouTube track now...");

      try {
        const added = await addTrackFromUrl(addTrackUrl, {
          requestedBy: message.author.username,
        });
        console.log(
          "addTrack succeeded:",
          JSON.stringify({
            requestedBy: message.author.username,
            title: added.title,
            uploader: added.uploader || null,
            videoId: added.id,
            fileName: added.fileName,
          })
        );
        await sendToLog(
          message.guild,
          [
            "**Track Added**",
            `Requested by: ${message.author.username}`,
            `Title: ${added.title}`,
            `Audio sync: ${added.sync?.audio?.synced ? "ok" : `failed (${added.sync?.audio?.reason || "unknown"})`}`,
            `Catalog sync: ${added.sync?.catalog?.synced ? "ok" : `failed (${added.sync?.catalog?.reason || "unknown"})`}`,
          ].join("\n")
        );
        await maybeSendLibraryMilestone(message.guild, added);
        await message.reply(`✅ Added **${added.title}** to the lounge library.`);
      } catch (error) {
        if (error instanceof AddTrackError) {
          console.error("addTrack failed:", error.message, error.details || "");
          await message.reply(`❌ ${error.userMessage}`);
        } else {
          console.error("addTrack unexpected failure:", error);
          await message.reply("❌ Couldn't add that track due to an unexpected error.");
        }
      }

      return;
    }

    if (content === "!help") {
      await message.reply(
        [
          "**Melo Lounge Commands**",
          "`!start` - start radio in your current voice channel",
          "`!stop` - stop radio",
          "`!skip` - skip current track",
          "`!track` - show current track",
          "`!recent` - show recent spins",
          "`!library` or `/library` - show tracks in the library",
          "`!librarysync` or `!refreshlibrary` - sync library files/catalog and refresh available tracks",
          "`!linksteam <profileUrl>` - link your Steam account",
          "`!mysteam` - show your linked Steam account",
          "`!unlinksteam` - remove your linked Steam account",
          "`!whoson` - show linked members currently on Steam",
          "`!addtrack <youtubeLink>` - submit a YouTube track",
        ].join("\n")
      );
    }
  } catch (err) {
    console.error("messageCreate handler failed:", err);
  }
});

client.on("interactionCreate", async (interaction) => {
  try {
    if (!interaction.isStringSelectMenu() && !interaction.isButton()) {
      return;
    }

    if (!interaction.customId.startsWith("library:")) {
      return;
    }

    if (interaction.isButton()) {
      const [, action, rawPage] = interaction.customId.split(":");
      const page = Number.parseInt(rawPage, 10) || 0;

      if (action === "page" || action === "refresh") {
        await interaction.update(buildLibraryMessage(page));
      }

      return;
    }

    const requestedFileName = interaction.values[0];
    const result = requestTrackPlayback(requestedFileName, {
      requestedBy: interaction.user.username,
    });

    if (!result.ok) {
      const failureMessage =
        result.reason === "inactive_session"
          ? "Start the radio first, then pick a track from the library."
          : "That track could not be queued right now.";

      await interaction.reply({
        content: failureMessage,
        ephemeral: true,
      });
      return;
    }

    console.log(
      "library track selected:",
      JSON.stringify({
        requestedBy: interaction.user.username,
        title: result.track.name,
        fileName: result.track.fileName,
        interrupted: result.interrupted,
      })
    );

    await interaction.reply({
      content: result.interrupted
        ? `Queued **${result.track.name}** to play now.`
        : `Queued **${result.track.name}** to play next.`,
      ephemeral: true,
    });

    if (interaction.guild) {
      await sendEmbedToLog(interaction.guild, buildUpNextEmbed(result.track, interaction.user.username));
    }

    if (interaction.message?.editable) {
      await interaction.message.edit(buildLibraryMessage(0)).catch(() => {});
    }
  } catch (error) {
    console.error("interactionCreate handler failed:", error);

    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: "That library action failed.",
        ephemeral: true,
      }).catch(() => {});
    }
  }
});

client.on("voiceStateUpdate", async (oldState, newState) => {
  try {
    const member = newState.member || oldState.member;
    if (!member || member.user.bot) return;
    if (oldState.channelId === newState.channelId) return;
    const trackedChannelId = getTrackedLoungeChannelId();
    if (!trackedChannelId) return;

    const displayName = member.displayName || member.user.username;
    const joinedLounge =
      !oldState.channelId && newState.channelId === trackedChannelId;
    const leftLounge =
      oldState.channelId === trackedChannelId && !newState.channelId;
    const movedIntoLounge =
      oldState.channelId !== trackedChannelId &&
      newState.channelId === trackedChannelId;
    const movedOutOfLounge =
      oldState.channelId === trackedChannelId &&
      newState.channelId !== trackedChannelId;

    if (!joinedLounge && !leftLounge && !movedIntoLounge && !movedOutOfLounge) {
      return;
    }

    const loungeChannel = await newState.guild.channels.fetch(trackedChannelId).catch(() => null);
    const postChangeHeadcount = loungeChannel && "members" in loungeChannel
      ? [...loungeChannel.members.values()].filter((voiceMember) => !voiceMember.user.bot).length
      : 0;

    if (!oldState.channelId && newState.channelId) {
      const voiceChannel = newState.channel;
      if (!voiceChannel) return;

      console.log(`${displayName} joined ${voiceChannel.name}`);
      await updateLoungeStatusMessage(
        newState.guild,
        `${displayName} joined hardcore loungin`
      );
      if (joinedLounge && postChangeHeadcount === 1) {
        await announceLoungePresenceTransition(newState.guild, {
          type: "active",
          memberName: displayName,
          headcount: postChangeHeadcount,
        });
      }
      return;
    }

    if (oldState.channelId && !newState.channelId) {
      const voiceChannel = oldState.channel;
      if (!voiceChannel) return;

      console.log(`${displayName} left ${voiceChannel.name}`);
      await updateLoungeStatusMessage(
        oldState.guild,
        `${displayName} left hardcore loungin`
      );
      if (leftLounge && postChangeHeadcount === 0) {
        await announceLoungePresenceTransition(oldState.guild, {
          type: "empty",
          memberName: displayName,
          headcount: postChangeHeadcount,
        });
      }
      return;
    }

    if (oldState.channelId && newState.channelId) {
      const oldChannel = oldState.channel;
      const newChannel = newState.channel;

      console.log(
        `${displayName} moved from ${oldChannel?.name || oldState.channelId} to ${newChannel?.name || newState.channelId}`
      );

      const activity =
        newChannel?.id === trackedChannelId
          ? `${displayName} joined hardcore loungin`
          : `${displayName} left hardcore loungin`;

      await updateLoungeStatusMessage(newState.guild, activity);
      if (movedIntoLounge && postChangeHeadcount === 1) {
        await announceLoungePresenceTransition(newState.guild, {
          type: "active",
          memberName: displayName,
          headcount: postChangeHeadcount,
        });
      }

      if (movedOutOfLounge && postChangeHeadcount === 0) {
        await announceLoungePresenceTransition(newState.guild, {
          type: "empty",
          memberName: displayName,
          headcount: postChangeHeadcount,
        });
      }
    }
  } catch (err) {
    console.error("voiceStateUpdate handler failed:", err);
  }
});

async function bootstrapAndLogin() {
  try {
    const hydrationResult = await hydrateLibraryFromGithub();
    if (hydrationResult.hydrated) {
      console.log("Library restored from GitHub:", hydrationResult);
    } else {
      console.log("Library restore skipped:", hydrationResult);
    }
  } catch (error) {
    console.error("Library restore failed:", error.message);
  }

  await client.login(DISCORD_TOKEN);
}

bootstrapAndLogin().catch((error) => {
  console.error("Bot startup failed:", error);
  process.exit(1);
});
