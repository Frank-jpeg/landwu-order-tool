Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$OutputEncoding = [System.Text.UTF8Encoding]::new()
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()

$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoMobileDir = Split-Path -Parent $ProjectDir
$ScriptSource = Join-Path $RepoMobileDir "landwu-mobile-v2026.09.04.2.user.js"
$SdkRoot = $env:ANDROID_SDK_ROOT
if (-not $SdkRoot) { $SdkRoot = $env:ANDROID_HOME }
if (-not $SdkRoot) { $SdkRoot = "G:\Android\Sdk" }
if (-not (Test-Path -LiteralPath $SdkRoot)) { throw "Android SDK 不存在：$SdkRoot" }

$PlatformDir = Get-ChildItem -LiteralPath (Join-Path $SdkRoot "platforms") -Directory |
  Sort-Object Name -Descending |
  Select-Object -First 1
$BuildToolsDir = Get-ChildItem -LiteralPath (Join-Path $SdkRoot "build-tools") -Directory |
  Sort-Object Name -Descending |
  Select-Object -First 1
if (-not $PlatformDir) { throw "Android SDK platforms 为空" }
if (-not $BuildToolsDir) { throw "Android SDK build-tools 为空" }

$AndroidJar = Join-Path $PlatformDir.FullName "android.jar"
$Aapt2 = Join-Path $BuildToolsDir.FullName "aapt2.exe"
$D8 = Join-Path $BuildToolsDir.FullName "d8.bat"
$ZipAlign = Join-Path $BuildToolsDir.FullName "zipalign.exe"
$ApkSigner = Join-Path $BuildToolsDir.FullName "apksigner.bat"
foreach ($tool in @($AndroidJar, $Aapt2, $D8, $ZipAlign, $ApkSigner)) {
  if (-not (Test-Path -LiteralPath $tool)) { throw "缺少构建工具：$tool" }
}

$BuildDir = Join-Path $ProjectDir "build"
$CompiledDir = Join-Path $BuildDir "compiled"
$GeneratedDir = Join-Path $BuildDir "generated"
$ClassesDir = Join-Path $BuildDir "classes"
$DexDir = Join-Path $BuildDir "dex"
$AssetsDir = Join-Path $BuildDir "assets"
$OutputsDir = Join-Path $BuildDir "outputs"
Remove-Item -LiteralPath $BuildDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $CompiledDir, $GeneratedDir, $ClassesDir, $DexDir, $AssetsDir, $OutputsDir | Out-Null

if (-not (Test-Path -LiteralPath $ScriptSource)) { throw "手机版工作台脚本不存在：$ScriptSource" }
Copy-Item -LiteralPath $ScriptSource -Destination (Join-Path $AssetsDir "landwu-mobile.user.js")

$CompiledZip = Join-Path $CompiledDir "resources.zip"
& $Aapt2 compile --dir (Join-Path $ProjectDir "res") -o $CompiledZip
if ($LASTEXITCODE -ne 0) { throw "aapt2 compile 失败" }

$UnsignedApk = Join-Path $BuildDir "landwu-mobile-unsigned.apk"
& $Aapt2 link `
  -o $UnsignedApk `
  -I $AndroidJar `
  --manifest (Join-Path $ProjectDir "AndroidManifest.xml") `
  --java $GeneratedDir `
  -A $AssetsDir `
  --auto-add-overlay `
  $CompiledZip
if ($LASTEXITCODE -ne 0) { throw "aapt2 link 失败" }

$JavaSources = @()
$JavaSources += Get-ChildItem -LiteralPath (Join-Path $ProjectDir "src") -Recurse -Filter *.java | ForEach-Object { $_.FullName }
$JavaSources += Get-ChildItem -LiteralPath $GeneratedDir -Recurse -Filter *.java | ForEach-Object { $_.FullName }
& javac -encoding UTF-8 -source 1.8 -target 1.8 -classpath $AndroidJar -d $ClassesDir @JavaSources
if ($LASTEXITCODE -ne 0) { throw "javac 失败" }

$ClassFiles = Get-ChildItem -LiteralPath $ClassesDir -Recurse -Filter *.class | ForEach-Object { $_.FullName }
& $D8 --lib $AndroidJar --output $DexDir @ClassFiles
if ($LASTEXITCODE -ne 0) { throw "d8 失败" }

& jar uf $UnsignedApk -C $DexDir classes.dex
if ($LASTEXITCODE -ne 0) { throw "写入 classes.dex 失败" }

$AlignedApk = Join-Path $BuildDir "landwu-mobile-aligned.apk"
& $ZipAlign -f 4 $UnsignedApk $AlignedApk
if ($LASTEXITCODE -ne 0) { throw "zipalign 失败" }

$Keystore = Join-Path $ProjectDir "landwu-mobile-debug.keystore"
if (-not (Test-Path -LiteralPath $Keystore)) {
  & keytool -genkeypair -v `
    -keystore $Keystore `
    -storepass android `
    -alias androiddebugkey `
    -keypass android `
    -keyalg RSA `
    -keysize 2048 `
    -validity 10000 `
    -dname "CN=Android Debug,O=Android,C=US" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "生成 debug keystore 失败" }
}

$FinalApk = Join-Path $OutputsDir "landwu-mobile-debug.apk"
& $ApkSigner sign `
  --ks $Keystore `
  --ks-pass pass:android `
  --key-pass pass:android `
  --out $FinalApk `
  $AlignedApk
if ($LASTEXITCODE -ne 0) { throw "apksigner sign 失败" }

& $ApkSigner verify --verbose $FinalApk
if ($LASTEXITCODE -ne 0) { throw "apksigner verify 失败" }

Write-Host "APK 已生成：$FinalApk"
