#!/usr/bin/env bash
set -euo pipefail

if [ -z "${YT_DLP_PATH:-}" ] && [ -x ".render/bin/yt-dlp" ]; then
  export YT_DLP_PATH="$PWD/.render/bin/yt-dlp"
fi

exec node index.js
