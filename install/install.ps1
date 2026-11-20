# Installs create-bildr (a single executable) from a GitHub Release, on Windows x64 (and ARM64, through emulation).
#   irm https://github.com/webbegg/bildr/releases/latest/download/install.ps1 | iex
#
# Environment:
#   BILDR_VERSION       a release tag (v0.1.0) instead of the latest release
#   BILDR_INSTALL       install root; the binary goes to <root>\bin (default: %USERPROFILE%\.bildr)
#   BILDR_DOWNLOAD_URL  where the binary and SHA256SUMS are downloaded from (tests)
#
# The body runs in its own scope (& { ... }), so `irm | iex` leaves no variables and no
# $ErrorActionPreference behind in your session.
& {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'

  # Windows PowerShell 5.1 on older systems offers only TLS 1.0/1.1 by default, and GitHub needs 1.2.
  try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch { }

  if (-not [Environment]::Is64BitOperatingSystem) {
    throw 'unsupported architecture: only 64-bit Windows is supported.'
  }
  if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') {
    Write-Host 'Note: there is no native Windows ARM64 build yet; installing the x64 one, which Windows 11 on ARM runs under emulation.'
  }
  $name = 'create-bildr-windows-x64.exe'

  $releases = 'https://github.com/webbegg/bildr/releases'
  if ($env:BILDR_DOWNLOAD_URL) { $base = $env:BILDR_DOWNLOAD_URL.TrimEnd('/') }
  elseif ($env:BILDR_VERSION) { $base = "$releases/download/$($env:BILDR_VERSION)" }
  else { $base = "$releases/latest/download" }
  $root = if ($env:BILDR_INSTALL) { $env:BILDR_INSTALL } else { Join-Path $env:USERPROFILE '.bildr' }
  $binDir = Join-Path $root 'bin'

  $tmp = Join-Path ([IO.Path]::GetTempPath()) "create-bildr-$([guid]::NewGuid())"
  New-Item -ItemType Directory -Path $tmp | Out-Null
  try {
    Write-Host "Downloading $name from $base"
    Invoke-WebRequest -UseBasicParsing "$base/$name" -OutFile (Join-Path $tmp $name)
    Invoke-WebRequest -UseBasicParsing "$base/SHA256SUMS" -OutFile (Join-Path $tmp 'SHA256SUMS')

    # SHA256SUMS lines are "<hash>  <file>" (or "<hash> *<file>"): split on whitespace.
    $expected = $null
    foreach ($line in Get-Content (Join-Path $tmp 'SHA256SUMS')) {
      $parts = $line.Trim() -split '\s+'
      if ($parts.Count -ge 2 -and $parts[1].TrimStart('*') -eq $name) {
        $expected = $parts[0]
        break
      }
    }
    if (-not $expected) { throw "SHA256SUMS has no entry for $name." }
    $actual = (Get-FileHash -Algorithm SHA256 (Join-Path $tmp $name)).Hash
    if ($expected -ne $actual) { throw "checksum mismatch for $name (expected $expected, got $actual). Nothing was installed." }

    New-Item -ItemType Directory -Force -Path $binDir | Out-Null
    Move-Item -Force (Join-Path $tmp $name) (Join-Path $binDir 'create-bildr.exe')
  } finally {
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
  }

  Write-Host "Installed create-bildr to $(Join-Path $binDir 'create-bildr.exe')"
  if (($env:Path -split ';') -notcontains $binDir) {
    Write-Host ''
    Write-Host 'Add it to your PATH for new terminals:'
    Write-Host "  [Environment]::SetEnvironmentVariable('Path', `"$binDir;`" + [Environment]::GetEnvironmentVariable('Path', 'User'), 'User')"
  }
  Write-Host ''
  Write-Host 'Next:'
  Write-Host '  create-bildr my-app'
  Write-Host ''
  Write-Host 'Running the created project needs Node 22.18+ and pnpm.'
}
