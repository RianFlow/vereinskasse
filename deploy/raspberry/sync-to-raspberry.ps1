$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$remoteHost = '192.168.178.54'
$remoteUser = 'svbarverdarts'
$remotePath = "/home/$remoteUser/vereinskasse-release"
$archiveName = 'vereinskasse-raspberry.tar.gz'
$tempArchive = Join-Path $repoRoot '.tmp/vereinskasse-raspberry.tar.gz'

New-Item -ItemType Directory -Force -Path (Join-Path $repoRoot '.tmp') | Out-Null

Write-Host "Packaging repository from $repoRoot..."
Push-Location $repoRoot
try {
  git archive --format=tar.gz --output $tempArchive HEAD
} finally {
  Pop-Location
}

if (-not (Test-Path $tempArchive)) {
  throw "Archive was not created: $tempArchive"
}

Write-Host "Uploading archive to $remoteUser@$remoteHost..."
$scpTarget = "${remoteUser}@${remoteHost}:/home/${remoteUser}/${archiveName}"
scp $tempArchive $scpTarget

$remoteArchivePath = "/home/$remoteUser/$archiveName"

$remoteScript = @(
  "mkdir -p /home/$remoteUser",
  "rm -rf $remotePath",
  "mkdir -p $remotePath",
  "tar -xzf $remoteArchivePath -C $remotePath --strip-components=1",
  "cd $remotePath/deploy/docker",
  'docker compose up --build -d',
  'docker compose ps'
) -join " && "

Write-Host "Starting deployment on the Raspberry..."
ssh $remoteUser@$remoteHost $remoteScript

Write-Host "Deployment completed."
Write-Host "Open http://192.168.178.54"
