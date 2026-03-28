const { spawn } = require("child_process");
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  StreamType,
} = require("@discordjs/voice");
const ffmpegPath = require("ffmpeg-static");

const sessions = new Map();

function getOrCreateSession(guildId) {
  if (!sessions.has(guildId)) {
    sessions.set(guildId, {
      connection: null,
      player: createAudioPlayer(),
      queue: [],
      currentTrack: null,
      currentProcess: null,
      textChannel: null,
    });
  }

  return sessions.get(guildId);
}

async function ensureConnection({ guild, voiceChannel, session }) {
  if (!session.connection) {
    session.connection = joinVoiceChannel({
      guildId: guild.id,
      channelId: voiceChannel.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: false,
    });

    await entersState(session.connection, VoiceConnectionStatus.Ready, 20_000);
    session.connection.subscribe(session.player);
  }
}

function createTrackStream(track) {
  if (!ffmpegPath) {
    throw new Error("ffmpeg-static is required for Discord playback.");
  }

  const ffmpeg = spawn(ffmpegPath, [
    "-reconnect",
    "1",
    "-reconnect_streamed",
    "1",
    "-reconnect_delay_max",
    "5",
    "-i",
    track.streamUrl,
    "-f",
    "s16le",
    "-ar",
    "48000",
    "-ac",
    "2",
    "pipe:1",
  ], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  ffmpeg.stderr.on("data", () => {});

  return {
    process: ffmpeg,
    resource: createAudioResource(ffmpeg.stdout, {
      inputType: StreamType.Raw,
      inlineVolume: true,
    }),
  };
}

async function playNext(guildId) {
  const session = sessions.get(guildId);
  if (!session) return;

  const nextTrack = session.queue.shift();
  if (!nextTrack) {
    session.currentTrack = null;
    if (session.textChannel) {
      session.textChannel.send("Queue finished.").catch(() => {});
    }
    return;
  }

  session.currentTrack = nextTrack;

  try {
    const { process, resource } = createTrackStream(nextTrack);
    session.currentProcess = process;

    if (resource.volume) {
      resource.volume.setVolume(0.22);
    }

    session.player.play(resource);

    if (session.textChannel) {
      await session.textChannel.send(
        `▶️ Now playing: **${nextTrack.displayTitle}**\n${nextTrack.youtubeUrl}`
      );
    }
  } catch (error) {
    if (session.textChannel) {
      await session.textChannel.send(`Track failed: ${nextTrack.displayTitle}. Skipping.`).catch(() => {});
    }
    await playNext(guildId);
  }
}

function wirePlayerEvents(guildId, session) {
  if (session._eventsWired) {
    return;
  }

  session.player.on(AudioPlayerStatus.Idle, () => {
    if (session.currentProcess) {
      session.currentProcess.kill("SIGKILL");
      session.currentProcess = null;
    }
    playNext(guildId).catch(() => {});
  });

  session.player.on("error", () => {
    if (session.currentProcess) {
      session.currentProcess.kill("SIGKILL");
      session.currentProcess = null;
    }
    playNext(guildId).catch(() => {});
  });

  session._eventsWired = true;
}

async function enqueueTracks({ guild, voiceChannel, textChannel, tracks }) {
  const session = getOrCreateSession(guild.id);
  wirePlayerEvents(guild.id, session);
  await ensureConnection({ guild, voiceChannel, session });

  session.textChannel = textChannel;
  session.queue.push(...tracks);

  if (!session.currentTrack) {
    await playNext(guild.id);
  }

  return {
    queued: tracks.length,
    queueDepth: session.queue.length + (session.currentTrack ? 1 : 0),
  };
}

function getNowPlaying(guildId) {
  const session = sessions.get(guildId);
  if (!session) return null;
  return session.currentTrack;
}

function skipTrack(guildId) {
  const session = sessions.get(guildId);
  if (!session || !session.currentTrack) return false;
  session.player.stop(true);
  return true;
}

function stopPlayback(guildId) {
  const session = sessions.get(guildId);
  if (!session) return false;

  session.queue = [];
  session.currentTrack = null;

  if (session.currentProcess) {
    session.currentProcess.kill("SIGKILL");
    session.currentProcess = null;
  }

  session.player.stop(true);
  if (session.connection) {
    session.connection.destroy();
    session.connection = null;
  }

  return true;
}

module.exports = {
  enqueueTracks,
  getNowPlaying,
  skipTrack,
  stopPlayback,
};
