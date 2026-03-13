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
  currentAudioLabel: null,
  isPlaying: false,
  stopRequested: false,
  skipRequested: false,
  activeChannelId: null,
  activeGuildId: null,
  recentlyPlayed: [],
};

const TRACK_NAME_MAP = {
  "93til": "Souls of Mischief - 93 'til Infinity",
  "black sheep - without a doubt": "Black Sheep - Without a Doubt",
  checkthetechnique: "Gang Starr - Check the Technique",
  lifesaver: "Guru - Lifesaver",
  "souls of mischief - cab fare (best quality) hq-640x360-avc1-opus":
    "Souls of Mischief - Cab Fare",
  "the lab rats - fluid-480x360-avc1-mp4a": "The Lab Rats - Fluid",
  theworldisyours: "Nas - The World Is Yours",
};

const LIBRARY_JSON_PATH = path.join(__dirname, "audio", "library", "library.json");

function getCleanTrackName(fileName) {
  const baseName = path.parse(fileName).name;
  const mappedName = TRACK_NAME_MAP[baseName.toLowerCase()];

  if (mappedName) {
    return mappedName;
  }

  return baseName
    .replace(/[-_](\d+x\d+|avc1|mp4a|opus)$/gi, "")
    .replace(/\s*\((.*?)\)\s*/g, " ")
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getLibraryTracks() {
  const libraryDir = path.join(__dirname, "audio", "library");

  if (!fs.existsSync(libraryDir)) return [];

  if (fs.existsSync(LIBRARY_JSON_PATH)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(LIBRARY_JSON_PATH, "utf8"));
      const tracks = Array.isArray(parsed) ? parsed : parsed?.tracks;

      if (Array.isArray(tracks)) {
        return tracks
          .filter((track) => track?.status === "ready" && track?.fileName)
          .map((track) => {
            const fullPath = path.join(libraryDir, track.fileName);

            return {
              fileName: track.fileName,
              name: track.title || getCleanTrackName(track.fileName),
              fullPath,
            };
          })
          .filter((track) => fs.existsSync(track.fullPath));
      }
    } catch (error) {
      console.error("Failed to read library.json; falling back to wav scan:", error.message);
    }
  }

  return fs
    .readdirSync(libraryDir)
    .filter((file) => file.toLowerCase().endsWith(".wav"))
    .map((file) => ({
      fileName: file,
      name: getCleanTrackName(file),
      fullPath: path.join(libraryDir, file),
    }));
}

function getRandomLibraryTrackNoRepeat() {
  const tracks = getLibraryTracks();
  if (!tracks.length) return null;

  let available = tracks.filter(
    (track) => !state.recentlyPlayed.includes(track.fileName)
  );

  if (!available.length) {
    state.recentlyPlayed = [];
    available = tracks;
  }

  const selected = available[Math.floor(Math.random() * available.length)];
  state.recentlyPlayed.push(selected.fileName);

  if (state.recentlyPlayed.length > 5) {
    state.recentlyPlayed.shift();
  }

  return selected;
}

async function playFile(filePath) {
  if (!state.connection || !state.player) {
    throw new Error("No active voice connection/player");
  }

  const player = state.player;
  const resource = createAudioResource(filePath);
  player.play(resource);

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
      player.off(AudioPlayerStatus.Idle, onIdle);
      player.off("error", onError);
    }

    player.once(AudioPlayerStatus.Idle, onIdle);
    player.once("error", onError);
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
        state.currentAudioLabel = "DJ Loungin' Intro";
        console.log("Playing intro sound first");
        try {
          await playFile(introPath);
        } catch (err) {
          console.error("Intro playback failed:", err);
        }
        state.currentAudioLabel = null;
        introPath = null;

        if (state.stopRequested) {
          break;
        }
      }

      const track = getRandomLibraryTrackNoRepeat();
      if (!track) {
        console.log("No library tracks found. Stopping session.");
        break;
      }

      state.currentTrack = track;
      state.currentAudioLabel = track.name;
      state.skipRequested = false;

      console.log("Random track chosen:", track.name);

      try {
        await playFile(track.fullPath);
      } catch (err) {
        console.error("Track playback failed:", err);
      }

      state.currentAudioLabel = null;

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
}

function skipCurrentTrack() {
  if (!state.player || !state.currentAudioLabel) {
    return null;
  }

  console.log("Skip requested for:", state.currentAudioLabel);
  state.skipRequested = true;

  try {
    state.player.stop(true);
    return state.currentAudioLabel;
  } catch {
    return null;
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
  state.currentAudioLabel = null;
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
