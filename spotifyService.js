const axios = require("axios");

const SPOTIFY_ACCOUNTS_BASE_URL = "https://accounts.spotify.com";
const SPOTIFY_API_BASE_URL = "https://api.spotify.com/v1";

let cachedAccessToken = null;
let cachedAccessTokenExpiresAt = 0;

function requireEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function buildSpotifyError(error, fallbackMessage) {
  const status = error.response?.status;
  const data = error.response?.data;

  const normalizedMessage =
    data?.error_description ||
    data?.error?.message ||
    (typeof data?.error === "string" ? data.error : null) ||
    error.message ||
    fallbackMessage;

  const details = [];
  if (status) {
    details.push(`status ${status}`);
  }

  if (data?.error && typeof data.error === "string" && data.error !== normalizedMessage) {
    details.push(data.error);
  }

  const detailSuffix = details.length ? ` (${details.join(", ")})` : "";
  return new Error(`${normalizedMessage}${detailSuffix}`);
}

async function getAccessToken() {
  if (cachedAccessToken && Date.now() < cachedAccessTokenExpiresAt - 30_000) {
    return cachedAccessToken;
  }

  const clientId = requireEnv("SPOTIFY_CLIENT_ID");
  const clientSecret = requireEnv("SPOTIFY_CLIENT_SECRET");
  const refreshToken = requireEnv("SPOTIFY_REFRESH_TOKEN");

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  let response;
  try {
    response = await axios.post(
      `${SPOTIFY_ACCOUNTS_BASE_URL}/api/token`,
      params.toString(),
      {
        headers: {
          Authorization: `Basic ${credentials}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );
  } catch (error) {
    throw buildSpotifyError(error, "Spotify token refresh failed");
  }

  if (!response.data?.access_token) {
    throw new Error("Spotify token refresh succeeded but no access token was returned");
  }

  cachedAccessToken = response.data.access_token;
  cachedAccessTokenExpiresAt = Date.now() + (response.data.expires_in || 3600) * 1000;
  return cachedAccessToken;
}

async function spotifyRequest(config) {
  const accessToken = await getAccessToken();

  try {
    const response = await axios({
      ...config,
      baseURL: SPOTIFY_API_BASE_URL,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(config.headers || {}),
      },
      validateStatus: (status) => status >= 200 && status < 300,
    });

    return response.data;
  } catch (error) {
    throw buildSpotifyError(error, "Spotify API request failed");
  }
}

function normalizePlaylist(playlist) {
  return {
    id: playlist.id,
    uri: playlist.uri,
    name: playlist.name,
    ownerId: playlist.owner?.id || null,
    trackCount: playlist.tracks?.total ?? null,
    externalUrl: playlist.external_urls?.spotify || null,
  };
}

async function getCurrentSpotifyProfile() {
  const profile = await spotifyRequest({
    method: "get",
    url: "/me",
  });

  return {
    id: profile.id,
    displayName: profile.display_name || null,
    product: profile.product || null,
  };
}

async function getOwnedPlaylists() {
  const collected = [];
  let offset = 0;
  const limit = 50;
  const profile = await getCurrentSpotifyProfile();

  while (true) {
    const data = await spotifyRequest({
      method: "get",
      url: "/me/playlists",
      params: { limit, offset },
    });

    const pageItems = Array.isArray(data.items) ? data.items : [];
    collected.push(
      ...pageItems
        .filter((playlist) => playlist.owner?.id === profile.id)
        .map(normalizePlaylist)
    );

    if (!data.next || pageItems.length < limit) {
      break;
    }

    offset += limit;
  }

  return collected.sort((a, b) => a.name.localeCompare(b.name));
}

async function getDevices() {
  const data = await spotifyRequest({
    method: "get",
    url: "/me/player/devices",
  });

  return Array.isArray(data.devices)
    ? data.devices.map((device) => ({
        id: device.id,
        name: device.name,
        type: device.type,
        isActive: Boolean(device.is_active),
        volumePercent: device.volume_percent ?? null,
      }))
    : [];
}

async function getCurrentPlayback() {
  const accessToken = await getAccessToken();

  try {
    const response = await axios.get(`${SPOTIFY_API_BASE_URL}/me/player`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      validateStatus: (status) => status === 204 || (status >= 200 && status < 300),
    });

    if (response.status === 204 || !response.data) {
      return {
        isPlaying: false,
        progressMs: 0,
        contextName: null,
        item: null,
      };
    }

    const data = response.data;
    return {
      isPlaying: Boolean(data.is_playing),
      progressMs: data.progress_ms || 0,
      contextName: data.context?.type || null,
      item: data.item
        ? {
            id: data.item.id,
            name: data.item.name,
            durationMs: data.item.duration_ms,
            artists: Array.isArray(data.item.artists)
              ? data.item.artists.map((artist) => artist.name)
              : [],
            externalUrl: data.item.external_urls?.spotify || null,
          }
        : null,
    };
  } catch (error) {
    throw buildSpotifyError(error, "Spotify playback lookup failed");
  }
}

async function startPlaylistPlayback({ playlistUri, deviceId = null }) {
  const params = deviceId ? { device_id: deviceId } : undefined;
  await spotifyRequest({
    method: "put",
    url: "/me/player/play",
    params,
    data: {
      context_uri: playlistUri,
    },
  });
}

async function pausePlayback({ deviceId = null } = {}) {
  const params = deviceId ? { device_id: deviceId } : undefined;
  await spotifyRequest({
    method: "put",
    url: "/me/player/pause",
    params,
  });
}

async function resumePlayback({ deviceId = null } = {}) {
  const params = deviceId ? { device_id: deviceId } : undefined;
  await spotifyRequest({
    method: "put",
    url: "/me/player/play",
    params,
  });
}

async function skipToNextTrack({ deviceId = null } = {}) {
  const params = deviceId ? { device_id: deviceId } : undefined;
  await spotifyRequest({
    method: "post",
    url: "/me/player/next",
    params,
  });
}

async function skipToPreviousTrack({ deviceId = null } = {}) {
  const params = deviceId ? { device_id: deviceId } : undefined;
  await spotifyRequest({
    method: "post",
    url: "/me/player/previous",
    params,
  });
}

async function setPlaybackVolume({ volumePercent, deviceId = null }) {
  const params = {
    volume_percent: volumePercent,
    ...(deviceId ? { device_id: deviceId } : {}),
  };

  await spotifyRequest({
    method: "put",
    url: "/me/player/volume",
    params,
  });
}


async function getPlaylistTracks(playlistId) {
  if (!playlistId) {
    throw new Error("playlistId is required");
  }

  const collected = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const data = await spotifyRequest({
      method: "get",
      url: `/playlists/${playlistId}/tracks`,
      params: {
        limit,
        offset,
      },
    });

    const pageItems = Array.isArray(data.items) ? data.items : [];

    collected.push(
      ...pageItems
        .map((item) => item?.track)
        .filter((track) => track && track.type === "track")
        .map((track) => ({
          id: track.id || null,
          name: track.name || "Unknown track",
          artists: Array.isArray(track.artists)
            ? track.artists.map((artist) => artist.name).filter(Boolean)
            : [],
          durationMs: track.duration_ms || null,
          externalUrl: track.external_urls?.spotify || null,
        }))
    );

    if (!data.next || pageItems.length < limit) {
      break;
    }

    offset += limit;
  }

  return collected;
}
module.exports = {
  getCurrentSpotifyProfile,
  getCurrentPlayback,
  getDevices,
  getOwnedPlaylists,
  getPlaylistTracks,
  startPlaylistPlayback,
  pausePlayback,
  resumePlayback,
  skipToNextTrack,
  skipToPreviousTrack,
  setPlaybackVolume,
};
