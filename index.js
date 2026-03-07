require("dotenv").config();

const ffmpeg = require("ffmpeg-static");
process.env.FFMPEG_PATH = ffmpeg;

const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  MessageFlags,
} = require("discord.js");

const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  entersState,
  VoiceConnectionStatus,
} = require("@discordjs/voice");

const path = require("path");

const GENERAL_CHANNEL_ID = process.env.GENERAL_CHANNEL_ID;
const LOUNGE_VOICE_CHANNEL_ID = process.env.LOUNGE_VOICE_CHANNEL_ID;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.Reaction,
    Partials.User,
    Partials.GuildMember,
  ],
});

function ts() {
  const d = new Date();
  return d.toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

async function sendToGeneral(guild, content) {
  try {
    const ch = await guild.channels.fetch(GENERAL_CHANNEL_ID).catch(() => null);
    if (!ch || !ch.isTextBased()) return;

    await ch.send({
      content,
      allowedMentions: { parse: [] },
      flags: MessageFlags?.SuppressNotifications ?? 4096,
    });
  } catch (e) {
    console.error("sendToGeneral failed:", e);
  }
}

async function sendLog(guild, title, fields = [], color = 0x2f3136) {
  try {
    const ch = await guild.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
    if (!ch) return;

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setColor(color)
      .setTimestamp(new Date());

    if (fields.length) embed.addFields(fields);

    await ch.send({ embeds: [embed] });
  } catch (e) {
    console.error("Log send failed:", e);
  }
}

client.once("clientReady", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

/*
MEMBER JOIN / LEAVE
*/

client.on("guildMemberAdd", async (member) => {
  await sendLog(
    member.guild,
    "🟢 Member Joined",
    [
      { name: "User", value: `${member.user.tag} (${member.id})`, inline: false },
      { name: "Time", value: ts(), inline: true },
    ],
    0x57f287
  );
});

client.on("guildMemberRemove", async (member) => {
  const tag = member.user
    ? `${member.user.tag} (${member.id})`
    : `Unknown user (${member.id})`;

  await sendLog(
    member.guild,
    "🔴 Member Left",
    [
      { name: "User", value: tag, inline: false },
      { name: "Time", value: ts(), inline: true },
    ],
    0xed4245
  );
});

/*
VOICE LOUNGE HANDLER
*/

client.on("voiceStateUpdate", async (oldState, newState) => {
  try {
    const member = newState.member || oldState.member;
    if (!member || member.user.bot) return;

    const oldChannel = oldState.channel;
    const newChannel = newState.channel;

    const wasInLounge = oldChannel?.id === LOUNGE_VOICE_CHANNEL_ID;
    const isInLounge = newChannel?.id === LOUNGE_VOICE_CHANNEL_ID;

    if (!wasInLounge && isInLounge && newChannel) {

      const name = member.displayName || member.user.username;

      await sendToGeneral(newState.guild, `😎 ${name} is loungin'.`);

      const connection = joinVoiceChannel({
        channelId: newChannel.id,
        guildId: newChannel.guild.id,
        adapterCreator: newChannel.guild.voiceAdapterCreator,
        selfDeaf: false,
        selfMute: false,
      });

      try {
        await entersState(connection, VoiceConnectionStatus.Ready, 15000);
      } catch {
        console.log("Voice connection failed");
        connection.destroy();
        return;
      }

      const player = createAudioPlayer();

      const resource = createAudioResource(
        path.join(__dirname, "audio", "loungin.wav")
      );

      connection.subscribe(player);

      player.play(resource);
console.log("Creating audio resource from:", path.join(__dirname, "audio", "loungin.wav"));
console.log("Subscribing player to connection");
connection.subscribe(player);
console.log("Starting playback");
player.play(resource);
      player.on(AudioPlayerStatus.Idle, () => {
        connection.destroy();
      });

      player.on("error", (err) => {
        console.error("Audio player error:", err);
        connection.destroy();
      });
    }

    if (wasInLounge && !isInLounge) {
      const name = member.displayName || member.user.username;
      await sendToGeneral(oldState.guild, `🫡 ${name} has stopped loungin'.`);
    }

  } catch (err) {
    console.error("voiceStateUpdate failed:", err);
  }
  player.on("stateChange", (oldState, newState) => {
  console.log(`Audio player state: ${oldState.status} -> ${newState.status}`);
});
});

/*
MESSAGE LOGGING
*/

client.on("messageCreate", async (msg) => {
  if (!msg.guild || msg.author?.bot) return;

  const snippet = msg.content?.slice(0, 200) || "[no text]";

  await sendLog(
    msg.guild,
    "💬 Message Sent",
    [
      { name: "Author", value: `${msg.author.tag} (${msg.author.id})`, inline: false },
      { name: "Channel", value: `<#${msg.channelId}>`, inline: true },
      { name: "Jump", value: `[Open Message](${msg.url})`, inline: true },
      { name: "Content", value: "```" + snippet + "```", inline: false },
    ],
    0x2ecc71
  );
});

client.login(process.env.DISCORD_TOKEN);
