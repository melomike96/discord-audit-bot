require("dotenv").config();

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
} = require("@discordjs/voice");

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
    if (!ch) {
      console.log("General channel not found");
      return;
    }

    if (!ch.isTextBased()) {
      console.log("GENERAL_CHANNEL_ID is not a text channel:", ch.id, ch.name);
      return;
    }

    await ch.send({
      content,
      allowedMentions: { parse: [] },
      flags: MessageFlags?.SuppressNotifications ?? 4096,
    });
  } catch (e) {
    console.error("sendToGeneral failed:", e?.message || e);
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
    console.error("Log send failed:", e?.message || e);
  }
}

client.once("clientReady", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

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

      try {
        const connection = joinVoiceChannel({
          channelId: newChannel.id,
          guildId: newChannel.guild.id,
          adapterCreator: newChannel.guild.voiceAdapterCreator,
          selfDeaf: false,
          selfMute: false,
        });

        const player = createAudioPlayer();
        const resource = createAudioResource("./audio/loungin.wav");

        connection.subscribe(player);
        player.play(resource);

        player.on(AudioPlayerStatus.Idle, () => {
          connection.destroy();
        });

        player.on("error", (err) => {
          console.error("Audio player error:", err?.message || err);
          connection.destroy();
        });
      } catch (err) {
        console.error("Audio error:", err?.message || err);
      }
    }

    if (wasInLounge && !isInLounge) {
      const name = member.displayName || member.user.username;
      await sendToGeneral(oldState.guild, `🫡 ${name} has stopped loungin'.`);
    }
  } catch (err) {
    console.error("voiceStateUpdate failed:", err?.message || err);
  }
});
client.on("messageCreate", async (msg) => {
  if (!msg.guild) return;
  if (msg.author?.bot) return;

  const snippet = msg.content?.length ? msg.content.slice(0, 200) : "[no text]";

  await sendLog(
    msg.guild,
    "💬 Message Sent",
    [
      { name: "Author", value: `${msg.author.tag} (${msg.author.id})`, inline: false },
      { name: "Channel", value: `<#${msg.channelId}>`, inline: true },
      { name: "Jump", value: `[Open Message](${msg.url})`, inline: true },
      { name: "Content", value: "```" + snippet.replace(/```/g, "'''") + "```", inline: false },
    ],
    0x2ecc71
  );
});

client.on("messageUpdate", async (oldMsg, newMsg) => {
  if (!newMsg.guild) return;
  if (newMsg.author?.bot) return;

  const oldText = oldMsg?.content ?? "[unknown/partial]";
  const newText = newMsg?.content ?? "[unknown/partial]";
  if (oldText === newText) return;

  await sendLog(
    newMsg.guild,
    "📝 Message Edited",
    [
      {
        name: "Author",
        value: `${newMsg.author?.tag ?? "Unknown"} (${newMsg.author?.id ?? "?"})`,
        inline: false,
      },
      { name: "Channel", value: `<#${newMsg.channelId}>`, inline: true },
      { name: "Jump", value: newMsg.url ? `[Open Message](${newMsg.url})` : "N/A", inline: true },
      {
        name: "Before",
        value: "```" + String(oldText).slice(0, 200).replace(/```/g, "'''") + "```",
        inline: false,
      },
      {
        name: "After",
        value: "```" + String(newText).slice(0, 200).replace(/```/g, "'''") + "```",
        inline: false,
      },
    ],
    0xf1c40f
  );
});

client.on("messageDelete", async (msg) => {
  if (!msg.guild) return;
  if (msg.author?.bot) return;

  const snippet = msg.content?.length ? msg.content.slice(0, 200) : "[no text or partial]";

  await sendLog(
    msg.guild,
    "🗑️ Message Deleted",
    [
      {
        name: "Author",
        value: msg.author ? `${msg.author.tag} (${msg.author.id})` : "Unknown (partial)",
        inline: false,
      },
      { name: "Channel", value: `<#${msg.channelId}>`, inline: true },
      { name: "Content", value: "```" + snippet.replace(/```/g, "'''") + "```", inline: false },
      { name: "Time", value: ts(), inline: false },
    ],
    0xe74c3c
  );
});

client.on("messageReactionAdd", async (reaction, user) => {
  try {
    if (user.bot) return;
    if (reaction.partial) await reaction.fetch();

    const msg = reaction.message;
    if (!msg.guild) return;

    await sendLog(
      msg.guild,
      "➕ Reaction Added",
      [
        { name: "User", value: `${user.tag} (${user.id})`, inline: false },
        { name: "Emoji", value: `${reaction.emoji}`, inline: true },
        { name: "Channel", value: `<#${msg.channelId}>`, inline: true },
        { name: "Jump", value: msg.url ? `[Open Message](${msg.url})` : "N/A", inline: false },
      ],
      0x9b59b6
    );
  } catch (e) {
    console.error("reaction add log failed:", e?.message || e);
  }
});

client.on("messageReactionRemove", async (reaction, user) => {
  try {
    if (user.bot) return;
    if (reaction.partial) await reaction.fetch();

    const msg = reaction.message;
    if (!msg.guild) return;

    await sendLog(
      msg.guild,
      "➖ Reaction Removed",
      [
        { name: "User", value: `${user.tag} (${user.id})`, inline: false },
        { name: "Emoji", value: `${reaction.emoji}`, inline: true },
        { name: "Channel", value: `<#${msg.channelId}>`, inline: true },
        { name: "Jump", value: msg.url ? `[Open Message](${msg.url})` : "N/A", inline: false },
      ],
      0x8e44ad
    );
  } catch (e) {
    console.error("reaction remove log failed:", e?.message || e);
  }
});

client.login(process.env.DISCORD_TOKEN);
