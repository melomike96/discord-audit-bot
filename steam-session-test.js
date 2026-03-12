const axios = require("axios");
const { EmbedBuilder } = require("discord.js");

async function postSteamSessionToLogs(client) {
  try {
    const channelName = (process.env.LOG_CHANNEL_NAME || "logs").trim();
    const steamApiKey = (process.env.STEAM_API_KEY || "").trim();
    const steamId = (process.env.STEAM_ID || "").trim();

    console.log("STEAM_API_KEY exists:", !!steamApiKey);
    console.log("STEAM_API_KEY length:", steamApiKey.length);
    console.log("STEAM_ID:", steamId);
    console.log("LOG_CHANNEL_NAME:", channelName);

    if (!steamApiKey || !steamId) {
      console.log("Missing STEAM_API_KEY or STEAM_ID");
      return;
    }

    const logChannel = client.channels.cache.find(
      (ch) => ch.name === channelName && ch.isTextBased()
    );

    if (!logChannel) {
      console.log(`Could not find text channel named "${channelName}"`);
      return;
    }

    const url = "https://api.steampowered.com/IPlayerService/GetRecentlyPlayedGames/v1/";
    console.log("Steam URL:", url);
    console.log("Steam params preview:", {
      keyLength: steamApiKey.length,
      steamid: steamId,
      count: 5,
    });

    const response = await axios.get(url, {
      params: {
        key: steamApiKey,
        steamid: steamId,
        count: 5,
      },
    });

    console.log("Steam recently played raw response:", JSON.stringify(response.data, null, 2));

    const games = response?.data?.response?.games || [];

    if (!games.length) {
      await logChannel.send("No recent Steam games found for this account.");
      return;
    }

    const topGame = games[0];
    const gameLines = games.map((g, i) => {
      const totalHours = ((g.playtime_forever || 0) / 60).toFixed(1);
      const last2WeeksHours = ((g.playtime_2weeks || 0) / 60).toFixed(1);
      return `${i + 1}. **${g.name}** — ${last2WeeksHours}h last 2 weeks, ${totalHours}h total`;
    });

    const embed = new EmbedBuilder()
      .setTitle("🎮 Steam Session Test")
      .setDescription("Recent Steam activity pulled successfully.")
      .addFields(
        { name: "Top Recent Game", value: topGame.name || "Unknown" },
        { name: "Recent Games", value: gameLines.join("\n").slice(0, 1024) }
      )
      .setTimestamp();

    await logChannel.send({ embeds: [embed] });
    console.log("Posted Steam session test to logs channel.");
  } catch (err) {
    console.error("postSteamSessionToLogs error status:", err.response?.status);
    console.error("postSteamSessionToLogs error data:", err.response?.data || err.message);
  }
}

module.exports = { postSteamSessionToLogs };