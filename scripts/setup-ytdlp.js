const fs = require("fs");
const path = require("path");
const https = require("https");
const { spawnSync } = require("child_process");

const projectRoot = path.resolve(__dirname, "..");
const binDir = path.join(projectRoot, ".runtime", "bin");

function getTargetInfo() {
  switch (process.platform) {
    case "linux":
      return {
        fileName: "yt-dlp",
        downloadUrl: "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp",
      };
    case "win32":
      return {
        fileName: "yt-dlp.exe",
        downloadUrl: "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe",
      };
    default:
      return null;
  }
}

function downloadFile(url, destination) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      if (
        response.statusCode &&
        response.statusCode >= 300 &&
        response.statusCode < 400 &&
        response.headers.location
      ) {
        response.resume();
        downloadFile(response.headers.location, destination).then(resolve, reject);
        return;
      }

      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`HTTP ${response.statusCode || "unknown"}`));
        return;
      }

      const file = fs.createWriteStream(destination);

      response.pipe(file);

      file.on("finish", () => {
        file.close(resolve);
      });

      file.on("error", (error) => {
        file.close(() => {
          fs.rm(destination, { force: true }, () => reject(error));
        });
      });
    });

    request.on("error", reject);
  });
}

function cleanupFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.rmSync(filePath, { force: true });
    }
  } catch (error) {
    console.warn(`[setup-ytdlp] Failed to remove ${filePath}: ${error.message}`);
  }
}

function isUsableBinary(filePath) {
  if (!fs.existsSync(filePath)) {
    return false;
  }

  try {
    const result = spawnSync(filePath, ["--version"], { stdio: "ignore" });
    return result.status === 0;
  } catch {
    return false;
  }
}

async function main() {
  const target = getTargetInfo();

  if (!target) {
    console.log(`[setup-ytdlp] Skipping unsupported platform: ${process.platform}`);
    return;
  }

  fs.mkdirSync(binDir, { recursive: true });
  const destination = path.join(binDir, target.fileName);
  const tempDestination = path.join(binDir, `${target.fileName}.download`);

  if (isUsableBinary(destination)) {
    console.log(`[setup-ytdlp] Using existing binary at ${destination}`);
    return;
  }

  cleanupFile(tempDestination);

  if (fs.existsSync(destination)) {
    console.log(`[setup-ytdlp] Replacing invalid binary at ${destination}`);
    cleanupFile(destination);
  }

  console.log(`[setup-ytdlp] Downloading ${target.downloadUrl}`);
  await downloadFile(target.downloadUrl, tempDestination);

  if (process.platform !== "win32") {
    fs.chmodSync(tempDestination, 0o755);
  }

  if (!isUsableBinary(tempDestination)) {
    cleanupFile(tempDestination);
    throw new Error("downloaded binary failed validation");
  }

  fs.renameSync(tempDestination, destination);
  console.log(`[setup-ytdlp] Installed to ${destination}`);
}

main().catch((error) => {
  console.warn(`[setup-ytdlp] Skipped: ${error.message}`);
});
