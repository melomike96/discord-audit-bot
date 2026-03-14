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
const { resolveCommand } = require("./audio/library/resolveCommand");

const {
  startLoungeSession,
  stopLoungeSession,
  skipCurrentTrack,
  getCurrentTrack,
  getLibraryTracks,
  hasActiveSession,
  requestTrackPlayback,
} = require("./radio");
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const GENERAL_CHANNEL_ID = process.env.GENERAL_CHANNEL_ID;
const LOUNGE_VOICE_CHANNEL_ID = process.env.LOUNGE_VOICE_CHANNEL_ID;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;
const PRIVATE_VOICE_CHANNEL_ID = process.env.PRIVATE_VOICE_CHANNEL_ID;
const LOCK_PATH = path.join(__dirname, ".bot.lock");
const LOUNGE_STATUS_PATH = path.join(__dirname, ".lounge-status.json");
const LIBRARY_PAGE_SIZE = 10;
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
});


function parseAddTrackCommand(content) {
  const match = content.match(/^!addtrack\s+(.+)$/i);
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

function writeLoungeStatusState(state) {
  try {
    fs.writeFileSync(LOUNGE_STATUS_PATH, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  } catch (error) {
    console.error("Failed to write lounge status state:", error);
  }
}

function formatTimestamp(date = new Date()) {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

async function getGeneralTextChannel(guild) {
  if (!GENERAL_CHANNEL_ID) {
    console.log("GENERAL_CHANNEL_ID missing, skipping lounge status update.");
    return null;
  }

  const channel = await guild.channels.fetch(GENERAL_CHANNEL_ID).catch(() => null);

  if (!channel) {
    console.log("General channel not found.");
    return null;
  }

  if (!channel.isTextBased()) {
    console.log("GENERAL_CHANNEL_ID is not a text channel.");
    return null;
  }

  return channel;
}

async function getOrCreateLoungeStatusMessage(guild) {
  const channel = await getGeneralTextChannel(guild);
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
    content: "Initializing lounge status...",
    allowedMentions: { parse: [] },
  });

  try {
    await createdMessage.pin();
  } catch (error) {
    console.error("Failed to pin lounge status message:", error);
  }

  writeLoungeStatusState({
    ...state,
    [guild.id]: createdMessage.id,
  });

  return createdMessage;
}

async function updateLoungeStatusMessage(guild, recentActivity = null) {
  if (!LOUNGE_VOICE_CHANNEL_ID) {
    return;
  }

  const loungeChannel = await guild.channels.fetch(LOUNGE_VOICE_CHANNEL_ID).catch(() => null);
  if (!loungeChannel || !("members" in loungeChannel)) {
    console.log("Lounge voice channel not found for status update.");
    return;
  }

  const memberNames = [...loungeChannel.members.values()]
    .filter((member) => !member.user.bot)
    .map((member) => member.displayName || member.user.username)
    .sort((a, b) => a.localeCompare(b));

  const statusLines = [
    "**Casual Loungin'**",
    memberNames.length
      ? `Currently loungin': ${memberNames.join(", ")}`
      : "Currently loungin': nobody",
    `Headcount: ${memberNames.length}`,
    `Last update: ${formatTimestamp()}`,
  ];

  if (recentActivity) {
    statusLines.push(`Recent activity: ${recentActivity}`);
  }

  const statusMessage = await getOrCreateLoungeStatusMessage(guild);
  if (!statusMessage) {
    return;
  }

  await statusMessage.edit({
    content: statusLines.join("\n"),
    allowedMentions: { parse: [] },
  });
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

      return;
    }

    if (content === "!stop") {
      console.log(`!stop received from ${message.author.username}`);
      stopLoungeSession();
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
        track ? `Now playing: **${track.name}**` : "Nothing playing right now."
      );
      return;
    }

    if (content === "!library" || content === "/library") {
      console.log(`!library received from ${message.author.username}`);
      await message.reply(buildLibraryMessage(0));
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
        const added = await addTrackFromUrl(addTrackUrl);
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
          "`!library` or `/library` - show tracks in the library",
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
    const result = requestTrackPlayback(requestedFileName);

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
    if (!LOUNGE_VOICE_CHANNEL_ID) return;

    const displayName = member.displayName || member.user.username;
    const joinedLounge =
      !oldState.channelId && newState.channelId === LOUNGE_VOICE_CHANNEL_ID;
    const leftLounge =
      oldState.channelId === LOUNGE_VOICE_CHANNEL_ID && !newState.channelId;
    const movedIntoLounge =
      oldState.channelId !== LOUNGE_VOICE_CHANNEL_ID &&
      newState.channelId === LOUNGE_VOICE_CHANNEL_ID;
    const movedOutOfLounge =
      oldState.channelId === LOUNGE_VOICE_CHANNEL_ID &&
      newState.channelId !== LOUNGE_VOICE_CHANNEL_ID;

    if (!joinedLounge && !leftLounge && !movedIntoLounge && !movedOutOfLounge) {
      return;
    }

    if (!oldState.channelId && newState.channelId) {
      const voiceChannel = newState.channel;
      if (!voiceChannel) return;

      console.log(`${displayName} joined ${voiceChannel.name}`);
      await updateLoungeStatusMessage(
        newState.guild,
        `${displayName} joined Casual Loungin'`
      );
      return;
    }

    if (oldState.channelId && !newState.channelId) {
      const voiceChannel = oldState.channel;
      if (!voiceChannel) return;

      console.log(`${displayName} left ${voiceChannel.name}`);
      await updateLoungeStatusMessage(
        oldState.guild,
        `${displayName} left Casual Loungin'`
      );
      return;
    }

    if (oldState.channelId && newState.channelId) {
      const oldChannel = oldState.channel;
      const newChannel = newState.channel;

      console.log(
        `${displayName} moved from ${oldChannel?.name || oldState.channelId} to ${newChannel?.name || newState.channelId}`
      );

      const activity =
        newChannel?.id === LOUNGE_VOICE_CHANNEL_ID
          ? `${displayName} joined Casual Loungin'`
          : `${displayName} left Casual Loungin'`;

      await updateLoungeStatusMessage(newState.guild, activity);
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
