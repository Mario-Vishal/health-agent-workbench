param(
  [string]$EnvPath = ".env"
)

$ErrorActionPreference = "Stop"

if (!(Test-Path ".env.example")) {
  throw "Run this script from the repository root."
}

if (!(Test-Path $EnvPath)) {
  Copy-Item ".env.example" $EnvPath
}

$secureKey = Read-Host "OpenAI API key" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
try {
  $apiKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}

if ([string]::IsNullOrWhiteSpace($apiKey)) {
  throw "OPENAI_API_KEY cannot be empty."
}

$lines = Get-Content $EnvPath
$updates = @{
  "LLM_PROVIDER" = "openai"
  "OPENAI_API_KEY" = $apiKey
}

foreach ($key in $updates.Keys) {
  $value = $updates[$key]
  if ($lines -match "^$key=") {
    $lines = $lines | ForEach-Object {
      if ($_ -match "^$key=") { "$key=$value" } else { $_ }
    }
  } else {
    $lines += "$key=$value"
  }
}

Set-Content -Path $EnvPath -Value $lines
Write-Host "Updated $EnvPath with LLM_PROVIDER=openai and OPENAI_API_KEY."
Write-Host "The file is ignored by Git. Do not commit it."
