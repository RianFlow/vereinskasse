$ErrorActionPreference = 'Stop'
$sshDir = "$HOME/.ssh"
New-Item -ItemType Directory -Force -Path $sshDir | Out-Null
$keyPath = Join-Path $sshDir 'id_ed25519_nopass'
if (-not (Test-Path $keyPath)) {
  & ssh-keygen -q -t ed25519 -N "" -f $keyPath -C 'svbarverdarts@users.noreply.github.com' | Out-Null
}
$configPath = Join-Path $sshDir 'config'
$config = @"
Host github.com
  HostName github.com
  User git
  IdentityFile $keyPath
  IdentitiesOnly yes
"@
Set-Content -Path $configPath -Value $config
& git config --global user.name 'svbarverdarts'
& git config --global user.email 'svbarverdarts@users.noreply.github.com'
& git remote set-url origin git@github.com:RianFlow/vereinskasse.git
Write-Host '---PUBKEY---'
if (Test-Path ($keyPath + '.pub')) {
  Get-Content ($keyPath + '.pub')
} else {
  Write-Host 'No public key found'
}
Write-Host '---REMOTE---'
& git remote -v
Write-Host '---SSH-TEST---'
& ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -T git@github.com -i $keyPath
