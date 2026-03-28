const { spawn } = require("child_process");
const path = require("path");
const { resolveCommand } = require("./audio/library/resolveCommand");

const PROJECT_ROOT = __dirname;
const LOCAL_YT_DLP_CANDIDATES = [
  path.join(PROJECT_ROOT, ".runtime", "bin", process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp"),
  path.join(PROJECT_ROOT, ".render", "bin", "yt-dlp"),
];

function getYtDlpCommand() {
  const command = resolveCommand(["yt-dlp"], {
    envVar: "YT_DLP_PATH",
    paths: LOCAL_YT_DLP_CANDIDATES,
  });

  if (!command) {
    throw new Error("yt-dlp is not installed. Install it and set YT_DLP_PATH if needed.");
  }

  return command;
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }

      reject(new Error(stderr.trim() || `Command failed with exit code ${code}`));
    });
  });
}

function safeTrackText(value) {
  return String(value || "")
    .replace(/[\n\r\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function resolveYoutubeTrackForSpotifyTrack(track) {
  const artists = Array.isArray(track.artists) ? track.artists.join(" ") : "";
  const query = `${safeTrackText(track.name)} ${safeTrackText(artists)} audio`;
  const ytDlpCommand = getYtDlpCommand();

  const result = await runCommand(ytDlpCommand, [
    "--default-search",
    "ytsearch1",
    "--print",
    "%(webpage_url)s\t%(title)s",
    query,
  ]);

  const firstLine = result.split(/\r?\n/).find(Boolean);
  if (!firstLine) {
    throw new Error(`No YouTube result found for ${track.name}`);
  }

  const [youtubeUrl, youtubeTitle] = firstLine.split("\t");

  if (!youtubeUrl || !youtubeUrl.startsWith("http")) {
    throw new Error(`Could not parse YouTube URL for ${track.name}`);
  }

  const streamUrl = await runCommand(ytDlpCommand, ["-f", "bestaudio/best", "-g", youtubeUrl]);
  const firstStreamUrl = streamUrl.split(/\r?\n/).find(Boolean);

  if (!firstStreamUrl || !firstStreamUrl.startsWith("http")) {
    throw new Error(`Could not resolve audio stream for ${track.name}`);
  }

  return {
    youtubeUrl,
    youtubeTitle: youtubeTitle || track.name,
    streamUrl: firstStreamUrl,
    displayTitle: `${track.name} - ${artists || "Unknown artist"}`,
  };
}

module.exports = {
  resolveYoutubeTrackForSpotifyTrack,
};
