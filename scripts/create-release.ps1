param([Parameter(Mandatory=$true)][string]$Source, [Parameter(Mandatory=$true)][string]$Target)
$ErrorActionPreference = 'Stop'
$skillDockDist = [System.IO.Path]::GetFullPath((Join-Path (Split-Path -Parent $PSScriptRoot) 'dist'))
$skillDockSource = (Resolve-Path -LiteralPath $Source).ProviderPath
$skillDockTarget = [System.IO.Path]::GetFullPath($Target)
if (-not $skillDockSource.StartsWith($skillDockDist + '\', [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Release source must be inside SkillDock dist.' }
if (-not $skillDockTarget.StartsWith($skillDockDist + '\', [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Release ZIP must be inside SkillDock dist.' }
if (Test-Path -LiteralPath $skillDockTarget) { throw 'Release ZIP already exists. Refusing to overwrite it.' }
if (Test-Path -LiteralPath (Join-Path $skillDockSource 'data')) { throw 'Release source contains runtime data. Refusing to package personal data.' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($skillDockSource, $skillDockTarget, [System.IO.Compression.CompressionLevel]::Optimal, $true)
