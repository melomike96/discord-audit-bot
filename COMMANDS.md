# Bot Commands and Testing

This file documents the user-facing Discord commands currently implemented in this repo, where they are handled, and how to test them safely.

## Where Commands Come From

User text commands are handled in [index.js](/abs/path/C:/Users/mikes/Documents/GitHub/discord-audit-bot/index.js) inside the `client.on("messageCreate", ...)` listener.

Radio playback logic lives in [radio.js](/abs/path/C:/Users/mikes/Documents/GitHub/discord-audit-bot/radio.js).

Voice join/leave lounge announcements are handled in [index.js](/abs/path/C:/Users/mikes/Documents/GitHub/discord-audit-bot/index.js) inside the `client.on("voiceStateUpdate", ...)` listener.

## Commands

### `!start`

Source:
[index.js](/abs/path/C:/Users/mikes/Documents/GitHub/discord-audit-bot/index.js)
calls `startLoungeSession(...)` in
[radio.js](/abs/path/C:/Users/mikes/Documents/GitHub/discord-audit-bot/radio.js)

What it does:
- Requires the user to already be in a voice channel.
- Prevents starting if a radio session is already active.
- Joins the user’s current voice channel.
- Plays the intro sound `audio/sounds/loungin_join.wav` once.
- Starts random playback from `audio/library`.
- Replies in Discord with:
`DJ Loungin' has started spinnin in **channel-name**.`

How to test:
1. Join a voice channel as a normal user.
2. Type `!start` in a text channel the bot can read.
3. Confirm the bot joins the same voice channel.
4. Confirm the intro sound plays once.
5. Confirm one library track starts after the intro.
6. Confirm the text reply appears only once.

### `!stop`

Source:
[index.js](/abs/path/C:/Users/mikes/Documents/GitHub/discord-audit-bot/index.js)
calls `stopLoungeSession()` in
[radio.js](/abs/path/C:/Users/mikes/Documents/GitHub/discord-audit-bot/radio.js)

What it does:
- Stops playback.
- Destroys the active voice connection.
- Clears the in-memory radio session state.
- Replies in Discord with:
`DJ Loungin' has been booed off stage.`

How to test:
1. Start the radio with `!start`.
2. Wait until audio is playing.
3. Type `!stop`.
4. Confirm the audio stops immediately.
5. Confirm the bot leaves voice.
6. Confirm the reply appears only once.

### `!skip`

Source:
[index.js](/abs/path/C:/Users/mikes/Documents/GitHub/discord-audit-bot/index.js)
calls `skipCurrentTrack()` in
[radio.js](/abs/path/C:/Users/mikes/Documents/GitHub/discord-audit-bot/radio.js)

What it does:
- Stops the currently playing audio item.
- If a library song is playing, the next song begins automatically.
- If the intro is playing, it skips the intro and moves on.
- Replies with the current audio label, for example:
`Skipping **The Lab Rats - Fluid**.`

How to test:
1. Start the radio with `!start`.
2. While the intro is playing, type `!skip`.
3. Confirm the bot replies with the skipped item name.
4. Start again and wait for a real track.
5. Type `!skip` again.
6. Confirm the track name is included in the reply.
7. Confirm a different track starts after the skipped one.

### `!track`

Source:
[index.js](/abs/path/C:/Users/mikes/Documents/GitHub/discord-audit-bot/index.js)
reads `getCurrentTrack()` from
[radio.js](/abs/path/C:/Users/mikes/Documents/GitHub/discord-audit-bot/radio.js)

What it does:
- Shows the currently selected library track.
- Replies with:
`Now playing: **Artist - Song**`
- If no library track is active, replies with:
`Nothing playing right now.`

How to test:
1. Start the radio.
2. Wait until a library track is playing.
3. Type `!track`.
4. Confirm the displayed title matches the audio track.

### `!addtrack <youtubeLink>`

Source:
[index.js](/abs/path/C:/Users/mikes/Documents/GitHub/discord-audit-bot/index.js)
calls `addTrackFromUrl(...)` in
[audio/library/addTrackService.js](/abs/path/C:/Users/mikes/Documents/GitHub/discord-audit-bot/audio/library/addTrackService.js)

What it does:
- Validates the YouTube URL.
- Requires `yt-dlp` to be installed and available on PATH.
- Requires `ffmpeg` to be installed and available on PATH.
- Downloads audio from YouTube.
- Converts the download to `.wav`.
- Saves the `.wav` into `audio/library`.
- Writes metadata into `audio/library/library.json`.
- Replies with either a success message or an error message.

How to test:
1. Type `!addtrack https://www.youtube.com/watch?v=...`
2. Confirm the bot first replies that it is processing the track.
3. Confirm the bot then replies with success or failure.
4. Confirm a new `.wav` file appears in [audio/library](/abs/path/C:/Users/mikes/Documents/GitHub/discord-audit-bot/audio/library).
5. Confirm a new track entry appears in [audio/library/library.json](/abs/path/C:/Users/mikes/Documents/GitHub/discord-audit-bot/audio/library/library.json).

Current local prerequisite check:
- `ffmpeg`: installed
- `yt-dlp`: missing

Current result:
- `!addtrack` will not work on this machine until `yt-dlp` is installed.

### `!help`

Source:
[index.js](/abs/path/C:/Users/mikes/Documents/GitHub/discord-audit-bot/index.js)

What it does:
- Sends a short list of available commands and their purpose.

How to test:
1. Type `!help`.
2. Confirm the command list appears once.

## Voice Join/Leave Announcements

Source:
[index.js](/abs/path/C:/Users/mikes/Documents/GitHub/discord-audit-bot/index.js)
inside `voiceStateUpdate`

What it does:
- Sends a text announcement when a member joins or leaves voice.
- Skips announcements for the private voice channel defined by `PRIVATE_VOICE_CHANNEL_ID`.
- Uses `GENERAL_CHANNEL_ID` as the text destination.

How to test:
1. Make sure `GENERAL_CHANNEL_ID` is set to a text channel.
2. Join a non-private voice channel.
3. Confirm one join message is posted.
4. Leave voice.
5. Confirm one leave message is posted.

## Track Naming

Library audio files live in:
[audio/library](/abs/path/C:/Users/mikes/Documents/GitHub/discord-audit-bot/audio/library)

Current library naming format:
- `Artist - Song.wav`

The bot also normalizes displayed track names in
[radio.js](/abs/path/C:/Users/mikes/Documents/GitHub/discord-audit-bot/radio.js)
so Discord messages stay clean.

## Why Actions Can Run Twice

If commands or voice announcements happen twice, the most likely cause is two bot processes running at the same time with the same Discord token.

This repo now creates a local lock file at:
[.bot.lock](/abs/path/C:/Users/mikes/Documents/GitHub/discord-audit-bot/.bot.lock)

What that lock does:
- Allows only one local bot process in this repo at a time.
- Causes a second copy to exit immediately at startup.
- Reduces duplicated command handling and duplicate voice announcements on the same machine.

## Proper Test Routine

Use this order when testing:
1. Stop any old bot terminals first.
2. Start one bot process only.
3. Wait for the bot ready log.
4. Test `!start`.
5. Test `!track`.
6. Test `!skip`.
7. Test `!stop`.
8. Test voice join/leave announcements.

## Useful Local Run Commands

From this repo:

```powershell
npm run dev
```

Or:

```powershell
node index.js
```

Use only one of those at a time. Do not run both together.
