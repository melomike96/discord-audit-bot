require("dotenv").config();

console.log("===== BOT STARTING =====");

const path = require("path");
const { Client, GatewayIntentBits } = require("discord.js");

const {
  startLoungeSession,
  stopLoungeSession,
  skipCurrentTrack,
  getCurrentTrack,
  hasActiveSession,
} = require("./radio");

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const GENERAL_CHANNEL_ID = process.env.GENERAL_CHANNEL_ID;
const PRIVATE_VOICE_CHANNEL_ID = process.env.PRIVATE_VOICE_CHANNEL_ID;

console.log("Loaded ENV:");
console.log("GENERAL_CHANNEL_ID:", GENERAL_CHANNEL_ID || "(not set)");
console.log("PRIVATE_VOICE_CHANNEL_ID:", PRIVATE_VOICE_CHANNEL_ID || "(not set)");

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

      await message.reply(`Starting Melo Lounge radio in **${voiceChannel.name}**...`);

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
      await message.reply("Stopped Melo Lounge radio.");
      return;
    }

    if (content === "!skip") {
      console.log(`!skip received from ${message.author.username}`);
      const skipped = skipCurrentTrack();
      await message.reply(skipped ? "Skipped current track." : "Nothing to skip.");
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

    if (content === "!help") {
      await message.reply(
        [
          "**Melo Lounge Commands**",
          "`!start` - start radio in your current voice channel",
          "`!stop` - stop radio",
          "`!skip` - skip current track",
          "`!track` - show current track",
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