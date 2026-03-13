#!/usr/bin/env bash
set -euo pipefail

npm ci

mkdir -p .render/bin
curl -L "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp" -o .render/bin/yt-dlp
chmod +x .render/bin/yt-dlp

.render/bin/yt-dlp --version
