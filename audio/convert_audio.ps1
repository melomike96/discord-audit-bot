$source = "$env:USERPROFILE\Downloads"
$dest = "C:\Users\mikes\Documents\GitHub\discord-audit-bot\audio"

Get-ChildItem "$source\*.mp4" | ForEach-Object {
    
    $output = Join-Path $dest ($_.BaseName + ".wav")

    ffmpeg -y -i "$($_.FullName)" `
        -vn `
        -ac 2 `
        -ar 48000 `
        "$output"

    Write-Host "Converted $($_.Name) -> $output"
}