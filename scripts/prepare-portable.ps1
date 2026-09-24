$ErrorActionPreference = 'Stop'
$destination = Join-Path $PSScriptRoot '../build/media-tools'
New-Item -ItemType Directory -Force -Path $destination | Out-Null
foreach ($tool in @('ffmpeg', 'ffprobe')) {
  $override = [Environment]::GetEnvironmentVariable('SW_' + $tool.ToUpperInvariant())
  $source = if ($override) { $override } else { (Get-Command "$tool.exe" -ErrorAction Stop).Source }
  Copy-Item -LiteralPath $source -Destination (Join-Path $destination "$tool.exe") -Force
  $license = Join-Path (Split-Path (Split-Path $source)) 'LICENSE.txt'
  if (!(Test-Path -LiteralPath $license)) { throw "Missing FFmpeg license: $license" }
  Copy-Item -LiteralPath $license -Destination (Join-Path $destination 'LICENSE.txt') -Force
}
@'
FFmpeg and FFprobe are standalone media tools invoked by ScrollWeave.
Build provider: https://github.com/BtbN/FFmpeg-Builds
Upstream source: https://ffmpeg.org/download.html
See LICENSE.txt for the bundled build's license.
'@ | Set-Content -LiteralPath (Join-Path $destination 'NOTICE.txt') -Encoding utf8
