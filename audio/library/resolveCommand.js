const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

function normalizeCandidates(candidates) {
  return candidates
    .filter(Boolean)
    .map((candidate) => String(candidate).trim())
    .filter(Boolean);
}

function canExecute(command) {
  try {
    const result = spawnSync(command, ["--version"], { stdio: "ignore" });
    return result.status === 0;
  } catch {
    return false;
  }
}

function getWindowsWingetCandidates(commands) {
  if (process.platform !== "win32") return [];

  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return [];

  const candidates = [];

  for (const command of commands) {
    candidates.push(path.join(localAppData, "Microsoft", "WinGet", "Links", `${command}.exe`));
  }

  candidates.push(
    path.join(
      localAppData,
      "Microsoft",
      "WinGet",
      "Packages",
      "yt-dlp.yt-dlp_Microsoft.Winget.Source_8wekyb3d8bbwe",
      "yt-dlp.exe"
    )
  );

  return candidates.filter((candidate) => fs.existsSync(candidate));
}

function getWhereCandidates(command) {
  if (process.platform !== "win32") return [];

  try {
    const result = spawnSync("where.exe", [command], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });

    if (result.status !== 0 || !result.stdout) return [];

    return result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((candidate) => fs.existsSync(candidate));
  } catch {
    return [];
  }
}

function resolveCommand(commands, options = {}) {
  const envCandidates = normalizeCandidates([
    options.envVar ? process.env[options.envVar] : null,
  ]);
  const explicitCandidates = normalizeCandidates(options.paths || []).filter((candidate) =>
    fs.existsSync(candidate)
  );

  for (const candidate of envCandidates) {
    if (canExecute(candidate)) return candidate;
  }

  for (const candidate of explicitCandidates) {
    if (canExecute(candidate)) return candidate;
  }

  for (const command of commands) {
    if (canExecute(command)) return command;
  }

  for (const command of commands) {
    for (const candidate of getWhereCandidates(command)) {
      if (canExecute(candidate)) return candidate;
    }
  }

  for (const candidate of getWindowsWingetCandidates(commands)) {
    if (canExecute(candidate)) return candidate;
  }

  return null;
}

module.exports = {
  resolveCommand,
};
