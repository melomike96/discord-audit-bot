require("dotenv").config();

console.log("===== BOT STARTING =====");

const fs = require("fs");
const path = require("path");
const { Client, GatewayIntentBits } = require("discord.js");
const { spawnSync } = require("child_process");

const { addTrackFromUrl, AddTrackError } = require("./audio/library/addTrackService");

const {
  startLoungeSession,
  stopLoungeSession,
  skipCurrentTrack,
  getCurrentTrack,
  hasActiveSession,
} = require("./radio");
const { addTrackFromYoutube } = require("./youtubeService");

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const GENERAL_CHANNEL_ID = process.env.GENERAL_CHANNEL_ID;
const PRIVATE_VOICE_CHANNEL_ID = process.env.PRIVATE_VOICE_CHANNEL_ID;
const LOCK_PATH = path.join(__dirname, ".bot.lock");

console.log("Loaded ENV:");
console.log("GENERAL_CHANNEL_ID:", GENERAL_CHANNEL_ID || "(not set)");
console.log("PRIVATE_VOICE_CHANNEL_ID:", PRIVATE_VOICE_CHANNEL_ID || "(not set)");

function commandExists(command) {
  try {
    const result = spawnSync(command, ["--version"], { stdio: "ignore" });
    return result.status === 0;
  } catch {
    return false;
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

if (!commandExists("yt-dlp") && !commandExists("yt_dlp")) {
  console.warn("WARNING: yt-dlp is not installed. `!addtrack` will not work until it is installed and available on PATH.");
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
          "`!addtrack <youtubeLink>` - submit a YouTube track",
        ].join("\n")
      );
    }
  } catch (err) {
    console.error("messageCreate handler failed:", err);
  }
});

client.on("voiceStateUpdate", async (oldState, newState) => {
  try {
    const member = newState.member || oldState.member;
    if (!member || member.user.bot) return;

    // only care about actual channel changes
    if (oldState.channelId === newState.channelId) return;

    const displayName = member.displayName || member.user.username;

    // joined a voice channel
    if (!oldState.channelId && newState.channelId) {
      const voiceChannel = newState.channel;
      if (!voiceChannel) return;

      console.log(`${displayName} joined ${voiceChannel.name}`);

      if (voiceChannel.id !== PRIVATE_VOICE_CHANNEL_ID) {
        await sendToGeneral(
          newState.guild,
          `🎵💻 ${displayName} is loungin'. 💻🎵`
        );
      } else {
        console.log("Private voice channel joined, skipping general message.");
      }

      return;
    }

    // left voice entirely
    if (oldState.channelId && !newState.channelId) {
      const voiceChannel = oldState.channel;
      if (!voiceChannel) return;

      console.log(`${displayName} left ${voiceChannel.name}`);

      if (voiceChannel.id !== PRIVATE_VOICE_CHANNEL_ID) {
        await sendToGeneral(
          oldState.guild,
          `💻🎵 ${displayName} is no longer loungin'. 🎵💻`
        );
      } else {
        console.log("Private voice channel left, skipping general message.");
      }

      return;
    }

    // moved from one channel to another
    if (oldState.channelId && newState.channelId) {
      const oldChannel = oldState.channel;
      const newChannel = newState.channel;

      console.log(
        `${displayName} moved from ${oldChannel?.name || oldState.channelId} to ${newChannel?.name || newState.channelId}`
      );

      if (oldChannel && oldChannel.id !== PRIVATE_VOICE_CHANNEL_ID) {
        await sendToGeneral(
          oldState.guild,
          `💻🎵 ${displayName} is no longer loungin'. 🎵💻`
        );
      }

      if (newChannel && newChannel.id !== PRIVATE_VOICE_CHANNEL_ID) {
        await sendToGeneral(
          newState.guild,
          `🎵💻 ${displayName} is loungin'. 💻🎵`
        );
      }
    }
  } catch (err) {
    console.error("voiceStateUpdate handler failed:", err);
  }
});

client.login(DISCORD_TOKEN);
