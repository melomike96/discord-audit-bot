const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const os = require("os");
const { spawn } = require("child_process");
const https = require("https");
const ffmpegPath = require("ffmpeg-static");
const { resolveCommand } = require("./resolveCommand");

const LIBRARY_DIR = __dirname;
const LIBRARY_JSON_PATH = path.join(LIBRARY_DIR, "library.json");
const PROJECT_ROOT = path.resolve(LIBRARY_DIR, "..", "..");
const LOCAL_YT_DLP_CANDIDATES = [
  path.join(PROJECT_ROOT, ".runtime", "bin", process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp"),
  path.join(PROJECT_ROOT, ".render", "bin", "yt-dlp"),
];
const RUNTIME_DIR = path.join(PROJECT_ROOT, ".runtime");
const GENERATED_COOKIES_PATH = path.join(RUNTIME_DIR, "yt-dlp-cookies.txt");

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

function listReadyTracks() {
  const catalog = loadLibraryCatalog();
  return catalog.tracks.filter((track) => track?.status === "ready");
}

function githubApiRequest({ method, requestPath, token, body }) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request(
      {
        hostname: "api.github.com",
        method,
        path: requestPath,
        headers: {
          "User-Agent": "discord-audit-bot",
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let responseBody = "";
        res.on("data", (chunk) => {
          responseBody += chunk.toString("utf8");
        });
        res.on("end", () => {
          const statusCode = res.statusCode || 0;
          if (statusCode >= 200 && statusCode < 300) {
            if (!responseBody) {
              resolve({});
              return;
            }

            try {
              resolve(JSON.parse(responseBody));
            } catch {
              resolve({ raw: responseBody });
            }
            return;
          }

          reject(new Error(`GitHub API ${method} ${requestPath} failed with status ${statusCode}: ${responseBody}`));
        });
      }
    );

    req.on("error", (error) => {
      reject(error);
    });

    if (payload) {
      req.write(payload);
    }

    req.end();
  });
}

function getGithubSyncConfig() {
  const token = process.env.GITHUB_SYNC_TOKEN;
  const repo = process.env.GITHUB_SYNC_REPO;
  const branch = process.env.GITHUB_SYNC_BRANCH || "main";
  const filePath = process.env.GITHUB_SYNC_FILE_PATH || "audio/library/library.json";

  if (!token || !repo) {
    return null;
  }

  return {
    token,
    repo,
    branch,
    catalogPath: filePath,
    libraryDirPath: path.posix.dirname(filePath),
  };
}

async function putGithubFile({ token, repo, branch, filePath, content, sha = undefined }) {
  await githubApiRequest({
    method: "PUT",
    requestPath: `/repos/${repo}/contents/${encodeURIComponent(filePath).replace(/%2F/g, "/")}`,
    token,
    body: {
      message: `chore(library): sync ${filePath} ${new Date().toISOString()}`,
      content,
      sha,
      branch,
    },
  });
}

async function getGithubFileSha({ token, repo, branch, filePath }) {
  try {
    const encodedPath = encodeURIComponent(filePath).replace(/%2F/g, "/");
    const current = await githubApiRequest({
      method: "GET",
      requestPath: `/repos/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`,
      token,
    });
    return current.sha || null;
  } catch (error) {
    if (error.message.includes("status 404")) {
      return null;
    }

    throw error;
  }
}

async function getGithubFileContent({ token, repo, branch, filePath }) {
  const encodedPath = encodeURIComponent(filePath).replace(/%2F/g, "/");
  return githubApiRequest({
    method: "GET",
    requestPath: `/repos/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`,
    token,
  });
}

async function syncCatalogToGithub(catalog) {
  const config = getGithubSyncConfig();

  if (!config) {
    return { synced: false, reason: "disabled" };
  }

  const { token, repo, branch, catalogPath } = config;
  const sha = await getGithubFileSha({ token, repo, branch, filePath: catalogPath });

  await putGithubFile({
    token,
    repo,
    branch,
    filePath: catalogPath,
    content: Buffer.from(`${JSON.stringify(catalog, null, 2)}\n`, "utf8").toString("base64"),
    sha,
  });

  return { synced: true, repo, branch, filePath: catalogPath };
}

async function syncTrackAudioToGithub(outputPath, outputFileName) {
  const config = getGithubSyncConfig();

  if (!config) {
    return { synced: false, reason: "disabled" };
  }

  const { token, repo, branch, libraryDirPath } = config;
  const filePath = path.posix.join(libraryDirPath, outputFileName);
  const sha = await getGithubFileSha({ token, repo, branch, filePath });

  await putGithubFile({
    token,
    repo,
    branch,
    filePath,
    content: fs.readFileSync(outputPath).toString("base64"),
    sha,
  });

  return { synced: true, repo, branch, filePath };
}

async function hydrateLibraryFromGithub() {
  const config = getGithubSyncConfig();

  if (!config) {
    return { hydrated: false, reason: "disabled" };
  }

  const { token, repo, branch, catalogPath, libraryDirPath } = config;

  ensureDir(LIBRARY_DIR);

  let remoteCatalog;
  try {
    remoteCatalog = await getGithubFileContent({
      token,
      repo,
      branch,
      filePath: catalogPath,
    });
  } catch (error) {
    if (error.message.includes("status 404")) {
      return { hydrated: false, reason: "catalog_missing" };
    }

    throw error;
  }

  const decodedCatalog = Buffer.from(
    String(remoteCatalog.content || "").replace(/\s+/g, ""),
    "base64"
  ).toString("utf8");
  const catalog = parseLibraryCatalog(JSON.parse(decodedCatalog));
  saveLibraryCatalog(catalog);

  let downloadedTracks = 0;

  for (const track of catalog.tracks) {
    if (track?.status !== "ready" || !track.fileName) {
      continue;
    }

    const localPath = path.join(LIBRARY_DIR, track.fileName);
    if (fs.existsSync(localPath)) {
      continue;
    }

    const remotePath = path.posix.join(libraryDirPath, track.fileName);

    try {
      const remoteAudio = await getGithubFileContent({
        token,
        repo,
        branch,
        filePath: remotePath,
      });
      const audioBuffer = Buffer.from(
        String(remoteAudio.content || "").replace(/\s+/g, ""),
        "base64"
      );
      fs.writeFileSync(localPath, audioBuffer);
      downloadedTracks += 1;
    } catch (error) {
      console.error(`Library audio restore failed for ${track.fileName}:`, error.message);
    }
  }

  return {
    hydrated: true,
    repo,
    branch,
    catalogPath,
    downloadedTracks,
    totalTracks: catalog.tracks.filter((track) => track?.status === "ready" && track?.fileName).length,
  };
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
  const command = resolveCommand(["yt-dlp", "yt_dlp"], {
    envVar: "YT_DLP_PATH",
    paths: LOCAL_YT_DLP_CANDIDATES,
  });
  if (command) return command;

  throw new AddTrackError(
    "yt-dlp binary not found",
    "yt-dlp is not installed on the host. Install yt-dlp and retry `!addtrack`."
  );
}

function getNodeJsRuntimeArg() {
  const nodeCommand = resolveCommand(["node"], {
    paths: [process.execPath],
  });

  if (!nodeCommand) {
    return null;
  }

  return `node:${nodeCommand}`;
}

function ensureRuntimeDir() {
  if (!fs.existsSync(RUNTIME_DIR)) {
    fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  }
}

function resolveCookiesPath() {
  if (process.env.YT_DLP_COOKIES_PATH) {
    const configuredPath = path.resolve(PROJECT_ROOT, process.env.YT_DLP_COOKIES_PATH);

    if (!fs.existsSync(configuredPath)) {
      throw new AddTrackError(
        "Configured cookies file missing",
        "The bot's yt-dlp cookies file is missing. Ask an admin to refresh the YouTube cookies."
      );
    }

    return configuredPath;
  }

  if (process.env.YT_DLP_COOKIES_B64) {
    ensureRuntimeDir();

    try {
      const normalized = process.env.YT_DLP_COOKIES_B64.replace(/\s+/g, "");
      const decoded = Buffer.from(normalized, "base64").toString("utf8");

      if (
        !decoded.startsWith("# HTTP Cookie File") &&
        !decoded.startsWith("# Netscape HTTP Cookie File")
      ) {
        throw new Error("cookies file is not in Netscape format");
      }

      const newline = os.platform() === "win32" ? "\r\n" : "\n";
      const normalizedDecoded = decoded.replace(/\r?\n/g, newline);
      fs.writeFileSync(GENERATED_COOKIES_PATH, normalizedDecoded, "utf8");
      return GENERATED_COOKIES_PATH;
    } catch (error) {
      throw new AddTrackError(
        "Invalid YT_DLP_COOKIES_B64",
        "The bot's yt-dlp cookies are invalid. Ask an admin to refresh the YouTube cookies.",
        error.message
      );
    }
  }

  return null;
}

function buildYtDlpArgs(baseArgs) {
  const args = [];
  const cookiesPath = resolveCookiesPath();
  const nodeJsRuntime = getNodeJsRuntimeArg();

  if (cookiesPath) {
    args.push("--cookies", cookiesPath);
  }

  if (process.env.YT_DLP_USER_AGENT) {
    args.push("--user-agent", process.env.YT_DLP_USER_AGENT);
  }

  if (nodeJsRuntime) {
    args.push("--js-runtimes", nodeJsRuntime);
  }

  return [...args, ...baseArgs];
}

function getYtDlpConfigSummary() {
  let cookiesStatus = "disabled";
  let cookiesPath = null;

  try {
    cookiesPath = resolveCookiesPath();
    if (cookiesPath) {
      cookiesStatus = `enabled (${cookiesPath})`;
    }
  } catch (error) {
    cookiesStatus = `invalid (${error.message})`;
  }

  return {
    ytDlpCommand: resolveCommand(["yt-dlp", "yt_dlp"], {
      envVar: "YT_DLP_PATH",
      paths: LOCAL_YT_DLP_CANDIDATES,
    }) || null,
    cookiesStatus,
    userAgentConfigured: Boolean(process.env.YT_DLP_USER_AGENT),
    jsRuntime: getNodeJsRuntimeArg() || "unavailable",
  };
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
    const { stdout } = await runCommand(ytDlpCommand, buildYtDlpArgs([
      "--dump-single-json",
      "--no-playlist",
      canonicalUrl,
    ]));

    const metadata = JSON.parse(stdout);
    return {
      title: metadata.title || "Unknown Title",
      durationSeconds: Number.isFinite(metadata.duration) ? metadata.duration : null,
      uploader: metadata.uploader || null,
      webpageUrl: metadata.webpage_url || canonicalUrl,
    };
  } catch (error) {
    const details = error.message || "";
    const cookiesInvalid =
      details.includes("The provided YouTube account cookies are no longer valid");
    const requiresAuth =
      details.includes("Sign in to confirm you're not a bot");
    const missingJsRuntime =
      details.includes("No supported JavaScript runtime could be found");

    let userMessage =
      "Could not read metadata from YouTube URL. Confirm the link is public and try again.";

    if (cookiesInvalid) {
      userMessage =
        "The bot's YouTube cookies have expired or were rotated. Ask an admin to refresh them and try again.";
    } else if (requiresAuth) {
      userMessage =
        "YouTube blocked this request as a bot check. Ask an admin to refresh yt-dlp cookies or try a different video.";
    } else if (missingJsRuntime) {
      userMessage =
        "yt-dlp could not find a supported JavaScript runtime on the host. Ask an admin to check the bot deploy logs.";
    }

    throw new AddTrackError(
      "Failed to fetch video metadata",
      userMessage,
      details
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

function trackHasLocalAudioFile(track) {
  if (!track || track.status !== "ready") {
    return false;
  }

  if (track.filePath && fs.existsSync(track.filePath)) {
    return true;
  }

  if (track.fileName) {
    return fs.existsSync(path.join(LIBRARY_DIR, track.fileName));
  }

  return false;
}

async function addTrackFromUrl(inputUrl) {
  const { videoId, canonicalUrl } = normalizeYouTubeUrl(inputUrl);
  const catalog = loadLibraryCatalog();

  const duplicate = catalog.tracks.find(
    (track) => track.canonicalUrl === canonicalUrl && track.status === "ready"
  );

  if (duplicate) {
    if (trackHasLocalAudioFile(duplicate)) {
      throw new AddTrackError(
        "Duplicate track",
        `This track is already in the library as **${duplicate.title || duplicate.name || duplicate.fileName}**.`
      );
    }

    catalog.tracks = catalog.tracks.filter(
      (track) => !(track.canonicalUrl === canonicalUrl && track.status === "ready")
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
    await runCommand(ytDlpCommand, buildYtDlpArgs([
      "--no-playlist",
      "-f",
      "bestaudio/best",
      "-o",
      `${tempDownloadPath}.%(ext)s`,
      canonicalUrl,
    ]));

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

    let audioSyncResult = { synced: false, reason: "disabled" };
    let catalogSyncResult = { synced: false, reason: "disabled" };

    try {
      audioSyncResult = await syncTrackAudioToGithub(outputPath, outputFileName);
      if (audioSyncResult.synced) {
        console.log("Library audio synced to GitHub:", audioSyncResult);
      }
    } catch (error) {
      console.error("Library audio GitHub sync failed:", error.message);
      audioSyncResult = { synced: false, reason: "error", details: error.message };
    }

    try {
      catalogSyncResult = await syncCatalogToGithub(catalog);
      if (catalogSyncResult.synced) {
        console.log("Library catalog synced to GitHub:", catalogSyncResult);
      }
    } catch (error) {
      console.error("Library catalog GitHub sync failed:", error.message);
      catalogSyncResult = { synced: false, reason: "error", details: error.message };
    }

    return {
      ...record,
      sync: {
        audio: audioSyncResult,
        catalog: catalogSyncResult,
      },
    };
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
  listReadyTracks,
  normalizeYouTubeUrl,
  AddTrackError,
  hydrateLibraryFromGithub,
  LIBRARY_JSON_PATH,
  getYtDlpConfigSummary,
};
