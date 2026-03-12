const fs = require("fs");
const path = require("path");
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
} = require("@discordjs/voice");

const state = {
  connection: null,
  player: null,
  currentTrack: null,
  isPlaying: false,
  stopRequested: false,
  skipRequested: false,
  activeChannelId: null,
  activeGuildId: null,
  recentlyPlayed: [],
};

function getLibraryTracks() {
  const libraryDir = path.join(__dirname, "audio", "library");

  if (!fs.existsSync(libraryDir)) return [];

  return fs
    .readdirSync(libraryDir)
    .filter((file) => file.toLowerCase().endsWith(".wav"))
    .map((file) => ({
      name: file,
      fullPath: path.join(libraryDir, file),
    }));
}

function getRandomLibraryTrackNoRepeat() {
  const tracks = getLibraryTracks();
  if (!tracks.length) return null;

  let available = tracks.filter(
    (track) => !state.recentlyPlayed.includes(track.name)
  );

  if (!available.length) {
    state.recentlyPlayed = [];
    available = tracks;
  }

  const selected = available[Math.floor(Math.random() * available.length)];
  state.recentlyPlayed.push(selected.name);

  if (state.recentlyPlayed.length > 5) {
    state.recentlyPlayed.shift();
  }

  return selected;
}

async function playFile(filePath) {
  if (!state.connection || !state.player) {
    throw new Error("No active voice connection/player");
  }

  const resource = createAudioResource(filePath);
  state.player.play(resource);

  return new Promise((resolve, reject) => {
    const onIdle = () => {
      cleanupListeners();
      resolve();
    };

    const onError = (err) => {
      cleanupListeners();
      reject(err);
    };

    function cleanupListeners() {
      state.player.off(AudioPlayerStatus.Idle, onIdle);
      state.player.off("error", onError);
    }

    state.player.once(AudioPlayerStatus.Idle, onIdle);
    state.player.once("error", onError);
  });
}

async function startLoungeSession({ guild, voiceChannel, introPath = null }) {
  if (state.isPlaying) {
    console.log("Session already active, skipping new start.");
    return;
  }

  state.isPlaying = true;
  state.stopRequested = false;
  state.skipRequested = false;
  state.activeChannelId = voiceChannel.id;
  state.activeGuildId = guild.id;

  try {
    state.connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: false,
    });

    await entersState(state.connection, VoiceConnectionStatus.Ready, 20000);

    state.player = createAudioPlayer();
    state.connection.subscribe(state.player);

    console.log("Voice connection ready.");

    while (!state.stopRequested) {
      if (introPath && fs.existsSync(introPath)) {
        console.log("Playing intro sound first");
        try {
          await playFile(introPath);
        } catch (err) {
          console.error("Intro playback failed:", err);
        }
        introPath = null;
      }

      const track = getRandomLibraryTrackNoRepeat();
      if (!track) {
        console.log("No library tracks found. Stopping session.");
        break;
      }

      state.currentTrack = track;
      state.skipRequested = false;

      console.log("Random track chosen:", track.name);

      try {
        await playFile(track.fullPath);
      } catch (err) {
        console.error("Track playback failed:", err);
      }

      if (state.stopRequested) break;
    }
  } catch (err) {
    console.error("startLoungeSession error:", err);
  } finally {
    cleanupSession();
  }
}

function stopLoungeSession() {
  console.log("Stop requested.");
  state.stopRequested = true;

  if (state.player) {
    try {
      state.player.stop(true);
    } catch {}
  }

  cleanupSession();
}

function skipCurrentTrack() {
  if (!state.player || !state.currentTrack) {
    return false;
  }

  console.log("Skip requested for:", state.currentTrack.name);
  state.skipRequested = true;

  try {
    state.player.stop(true);
    return true;
  } catch {
    return false;
  }
}

function getCurrentTrack() {
  return state.currentTrack;
}

function hasActiveSession() {
  return state.isPlaying;
}

function cleanupSession() {
  if (state.connection) {
    try {
      state.connection.destroy();
    } catch {}
  }

  state.connection = null;
  state.player = null;
  state.currentTrack = null;
  state.isPlaying = false;
  state.stopRequested = false;
  state.skipRequested = false;
  state.activeChannelId = null;
  state.activeGuildId = null;

  console.log("Session cleaned up.");
}

module.exports = {
  startLoungeSession,
  stopLoungeSession,
  skipCurrentTrack,
  getCurrentTrack,
  hasActiveSession,
  state,
};