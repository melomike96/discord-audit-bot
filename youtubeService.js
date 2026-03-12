const axios = require("axios");

function normalizeTrackTitle(title) {
  return String(title || "")
    .replace(/\s*\([^)]*official[^)]*\)/gi, "")
    .replace(/\s*\([^)]*lyrics?[^)]*\)/gi, "")
    .replace(/\s*\[[^\]]*lyrics?[^\]]*\]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function addTrackFromYoutube({ url, addedBy }) {
  const oEmbedUrl = "https://www.youtube.com/oembed";

  let response;
  try {
    response = await axios.get(oEmbedUrl, {
      params: {
        url,
        format: "json",
      },
      timeout: 10000,
    });
  } catch (error) {
    if (error.response?.status === 404) {
      throw new Error("That YouTube link could not be found. Please confirm the URL and try again.");
    }

    throw new Error(
      "I couldn't fetch track details from YouTube right now. Please try again in a moment."
    );
  }

  const rawTitle = response.data?.title;
  if (!rawTitle) {
    throw new Error("I found the link, but couldn't read a track title from YouTube.");
  }

  const normalizedTitle = normalizeTrackTitle(rawTitle);

  // Placeholder: metadata is resolved now so the bot can confirm submission.
  // A download/transcode pipeline can be added here later.
  return {
    normalizedTitle,
    queued: true,
    addedBy,
  };
}

module.exports = {
  addTrackFromYoutube,
};
