# Deploy kakeibo-bot (Node.js) from your PC to the Raspberry Pi (or any SSH host) and restart the systemd service.
# Usage: powershell -File deploy/deploy_kakeibo.ps1
#
# One-time setup required on the remote host before the first run (not done by this script):
#   1. mkdir -p /home/<user>/apps/kakeibo-bot/src /home/<user>/apps/kakeibo-bot/credentials
#   2. Copy your Google service account key JSON into
#      /home/<user>/apps/kakeibo-bot/credentials/service-account.json
#   3. Create /home/<user>/apps/kakeibo-bot/.env (see .env.example for the keys)
#   4. sudo cp deploy/kakeibo-bot.service /etc/systemd/system/kakeibo-bot.service
#      sudo systemctl daemon-reload
#      sudo systemctl enable kakeibo-bot
#
# Note: this file is saved as UTF-8 with a BOM and its comments are kept ASCII-only so that
# Windows PowerShell 5.1 (which reads non-BOM .ps1 files using the system's legacy ANSI
# codepage) never misreads it regardless of the machine's locale.

$ErrorActionPreference = "Stop"
$remoteHost = "your-pi-host.local"   # e.g. raspberrypi.local, or an IP address
$remoteUser = "<user>"
$remoteDir = "/home/$remoteUser/apps/kakeibo-bot"
$localDir = Split-Path -Parent $PSScriptRoot

Write-Host "Ensuring remote directories exist..."
ssh "$remoteHost" "mkdir -p $remoteDir/src"

Write-Host "Uploading package.json..."
scp "$localDir\package.json" "${remoteHost}:${remoteDir}/package.json"

Write-Host "Uploading src/*.js..."
scp "$localDir\src\*.js" "${remoteHost}:${remoteDir}/src/"

Write-Host "Installing dependencies and restarting service..."
ssh "$remoteHost" "cd $remoteDir && npm install --omit=dev && sudo systemctl restart kakeibo-bot"

Write-Host "Done."
