const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const ffmpegPath = require("ffmpeg-static");
const { resolveCommand } = require("./resolveCommand");

const LIBRARY_DIR = __dirname;
const LIBRARY_JSON_PATH = path.join(LIBRARY_DIR, "library.json");

class AddTrackError extends Error {
  constructor(message, userMessage, details = null) {
    super(message);
    this.name = "AddTrackError";
    this.userMessage = userMessage;
    this.details = details;
  }
}

function parseLibraryCatalog(raw) {
  if (!raw) return { tracks: [] };

  if (Array.isArray(raw)) {
    return { tracks: raw };
  }

  if (typeof raw === "object" && raw && Array.isArray(raw.tracks)) {
    return raw;
  }

  throw new AddTrackError(
    "Invalid library catalog format",
    "library.json is invalid. Please fix the file and try again."
  );
}

function loadLibraryCatalog() {
  if (!fs.existsSync(LIBRARY_JSON_PATH)) {
    return { tracks: [] };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(LIBRARY_JSON_PATH, "utf8"));
    return parseLibraryCatalog(parsed);
  } catch (error) {
    throw new AddTrackError(
      "Failed to read library.json",
      "Could not read track library metadata. Check library.json formatting.",
      error.message
    );
  }
}

function saveLibraryCatalog(catalog) {
  fs.writeFileSync(LIBRARY_JSON_PATH, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
}

function normalizeYouTubeUrl(inputUrl) {
  let url;

  try {
    url = new URL(inputUrl.trim());
  } catch {
    throw new AddTrackError(
      "Invalid URL",
      "That does not look like a valid URL. Please provide a YouTube link."
    );
  }

  const host = url.hostname.toLowerCase();
  let videoId = null;

  if (host === "youtu.be") {
    videoId = url.pathname.split("/").filter(Boolean)[0] || null;
  } else if (host.endsWith("youtube.com")) {
    if (url.pathname === "/watch") {
      videoId = url.searchParams.get("v");
    } else if (url.pathname.startsWith("/shorts/")) {
      videoId = url.pathname.split("/")[2] || null;
    } else if (url.pathname.startsWith("/embed/")) {
      videoId = url.pathname.split("/")[2] || null;
    }
  }

  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    throw new AddTrackError(
      "Missing/invalid YouTube video ID",
      "Unsupported YouTube URL. Use a standard video URL like https://www.youtube.com/watch?v=..."
    );
  }

  return {
    videoId,
    canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
  };
}

function getYtDlpCommand() {
  const command = resolveCommand(["yt-dlp", "yt_dlp"], { envVar: "YT_DLP_PATH" });
  if (command) return command;

  throw new AddTrackError(
    "yt-dlp binary not found",
    "yt-dlp is not installed on the host. Install yt-dlp and retry `!addtrack`."
  );
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("error", (error) => {
      reject(new Error(`Failed to run ${command}: ${error.message}`));
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(new Error(`${command} exited with code ${code}: ${stderr || stdout}`));
    });
  });
}

function slugify(value) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60);
}

function createDeterministicBaseName(title, videoId) {
  const slug = slugify(title) || "track";
  const shortId = crypto.createHash("sha1").update(videoId).digest("hex").slice(0, 8);
  return `${slug}-${shortId}`;
}

async function fetchVideoMetadata(ytDlpCommand, canonicalUrl) {
  try {
    const { stdout } = await runCommand(ytDlpCommand, [
      "--dump-single-json",
      "--no-playlist",
      canonicalUrl,
    ]);

    const metadata = JSON.parse(stdout);
    return {
      title: metadata.title || "Unknown Title",
      durationSeconds: Number.isFinite(metadata.duration) ? metadata.duration : null,
      uploader: metadata.uploader || null,
      webpageUrl: metadata.webpage_url || canonicalUrl,
    };
  } catch (error) {
    throw new AddTrackError(
      "Failed to fetch video metadata",
      "Could not read metadata from YouTube URL. Confirm the link is public and try again.",
      error.message
    );
  }
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function safeUnlink(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    console.warn(`Failed to cleanup file ${filePath}:`, error.message);
  }
}

async function addTrackFromUrl(inputUrl) {
  const { videoId, canonicalUrl } = normalizeYouTubeUrl(inputUrl);
  const catalog = loadLibraryCatalog();

  const duplicate = catalog.tracks.find(
    (track) => track.canonicalUrl === canonicalUrl && track.status === "ready"
  );

  if (duplicate) {
    throw new AddTrackError(
      "Duplicate track",
      `This track is already in the library as **${duplicate.title || duplicate.name || duplicate.fileName}**.`
    );
  }

  ensureDir(LIBRARY_DIR);
  const ytDlpCommand = getYtDlpCommand();
  const metadata = await fetchVideoMetadata(ytDlpCommand, canonicalUrl);
  const baseName = createDeterministicBaseName(metadata.title, videoId);

  const tempDownloadPath = path.join(LIBRARY_DIR, `${baseName}.download`);
  const outputFileName = `${baseName}.wav`;
  const outputPath = path.join(LIBRARY_DIR, outputFileName);

  try {
    await runCommand(ytDlpCommand, [
      "--no-playlist",
      "-f",
      "bestaudio/best",
      "-o",
      `${tempDownloadPath}.%(ext)s`,
      canonicalUrl,
    ]);

    const downloadedFile = fs
      .readdirSync(LIBRARY_DIR)
      .find((file) => file.startsWith(`${baseName}.download.`));

    if (!downloadedFile) {
      throw new AddTrackError(
        "Download output missing",
        "Download completed but no audio file was produced. Try again."
      );
    }

    const downloadedPath = path.join(LIBRARY_DIR, downloadedFile);

    await runCommand(ffmpegPath || "ffmpeg", [
      "-y",
      "-i",
      downloadedPath,
      "-ac",
      "2",
      "-ar",
      "48000",
      outputPath,
    ]);

    safeUnlink(downloadedPath);

    const record = {
      id: videoId,
      title: metadata.title,
      canonicalUrl,
      sourceUrl: metadata.webpageUrl,
      uploader: metadata.uploader,
      durationSeconds: metadata.durationSeconds,
      fileName: outputFileName,
      filePath: outputPath,
      status: "ready",
      addedAt: new Date().toISOString(),
    };

    catalog.tracks.push(record);
    saveLibraryCatalog(catalog);

    return record;
  } catch (error) {
    const partialFiles = fs
      .readdirSync(LIBRARY_DIR)
      .filter((file) => file.startsWith(baseName));

    partialFiles.forEach((file) => safeUnlink(path.join(LIBRARY_DIR, file)));

    if (error instanceof AddTrackError) {
      throw error;
    }

    throw new AddTrackError(
      "Download/convert failed",
      "Failed to download or convert this track. Verify the URL and ensure ffmpeg/yt-dlp are available.",
      error.message
    );
  }
}

module.exports = {
  addTrackFromUrl,
  normalizeYouTubeUrl,
  AddTrackError,
  LIBRARY_JSON_PATH,
};
