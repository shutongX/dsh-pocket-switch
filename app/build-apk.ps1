# 一键构建「我的电脑」安卓 APK：aapt2 + javac + d8 + zipalign + apksigner，不依赖 Gradle / Android Studio。
# 前置：Android build-tools 34、platform-34 的 android.jar 和 JDK 21（见 app/BUILD-APK.md）。
# 用法：powershell -ExecutionPolicy Bypass -File app\build-apk.ps1
param(
  [string]$AndroidTools = $env:DSH_ANDROID_TOOLS,
  [string]$JavaHome = $env:DSH_JAVA_HOME,
  [string]$Keystore = $env:DSH_APK_KEYSTORE,
  [string]$StorePass = $env:DSH_APK_STORE_PASS,
  [string]$KeyAlias = $(if ($env:DSH_APK_ALIAS) { $env:DSH_APK_ALIAS } else { "dsh" })
)
$ErrorActionPreference = "Continue"

$App = $PSScriptRoot
$Root = Split-Path -Parent $App
if (-not $AndroidTools) { $AndroidTools = $App }
if (-not $JavaHome) { $JavaHome = "C:\Program Files\Java\jdk-21" }
$BT = Join-Path $AndroidTools "build-tools\android-14"
$AndroidJar = Join-Path $AndroidTools "platform\android-34\android.jar"
$Www = Join-Path $App "www"
$Build = Join-Path $App "build"
$Dist = Join-Path $Root "dist"
$Checker = Join-Path $App "check-apk-entries.cjs"
$Version = (Get-Content (Join-Path $Root "package.json") -Raw | ConvertFrom-Json).version
$VersionCode = 1
if (-not $Keystore) { $Keystore = Join-Path $App "keystore\release.jks" }

$env:JAVA_HOME = $JavaHome
$env:PATH = (Join-Path $JavaHome "bin") + ";" + $env:PATH

foreach ($required in @("$BT\aapt2.exe", "$BT\zipalign.exe", "$BT\apksigner.bat", "$BT\d8.bat", $AndroidJar)) {
  if (-not (Test-Path $required)) { throw "缺少构建工具：$required（见 app/BUILD-APK.md）" }
}

Write-Host "== 1/8 准备目录和网页资源 =="
if (Test-Path $Build) { Remove-Item $Build -Recurse -Force }
New-Item -ItemType Directory -Force -Path "$Build\classes", "$Build\dex", "$Build\assets\www", $Dist | Out-Null
foreach ($name in @("index.html", "app.js", "style.css", "icon.svg", "manifest.webmanifest")) {
  Copy-Item (Join-Path $Www $name) (Join-Path "$Build\assets\www" $name) -Force
}
if (-not (Test-Path "$Build\assets\www\index.html")) { throw "网页资源拷贝失败：$Www" }

Write-Host "== 2/8 图标（icon.svg -> 512x512 PNG）=="
$icon = Join-Path $App "res\drawable\ic_launcher.png"
$edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
if (Test-Path $edge) {
  $iconTmp = Join-Path $env:TEMP "dsh-pocket-switch-icon.png"
  $iconUrl = "file:///" + (Join-Path $Www "icon.svg").Replace("\", "/")
  & $edge --headless=new --disable-gpu --hide-scrollbars --default-background-color=00000000 --window-size=512,512 --screenshot="$iconTmp" $iconUrl 2>&1 | Out-Null
  if (Test-Path $iconTmp) { Copy-Item $iconTmp $icon -Force }
}
if (-not (Test-Path $icon)) { throw "图标生成失败（没有 msedge 也没有现成的 ic_launcher.png）" }

Write-Host "== 3/8 javac 编译 =="
$javaSources = Get-ChildItem (Join-Path $App "src") -Recurse -Filter *.java | ForEach-Object { $_.FullName }
& (Join-Path $JavaHome "bin\javac.exe") -source 8 -target 8 -bootclasspath $AndroidJar -encoding UTF-8 -d "$Build\classes" $javaSources
if ($LASTEXITCODE -ne 0) { throw "javac 失败" }

Write-Host "== 4/8 d8 生成 classes.dex =="
$classFiles = Get-ChildItem "$Build\classes" -Recurse -Filter *.class | ForEach-Object { $_.FullName }
& "$BT\d8.bat" --lib $AndroidJar --min-api 24 --output "$Build\dex" $classFiles
if ($LASTEXITCODE -ne 0) { throw "d8 失败" }
if (-not (Test-Path "$Build\dex\classes.dex")) { throw "d8 没有产出 classes.dex" }

Write-Host "== 5/8 aapt2 编译资源并打包 base.apk =="
& "$BT\aapt2.exe" compile --dir (Join-Path $App "res") -o "$Build\res.zip"
if ($LASTEXITCODE -ne 0) { throw "aapt2 compile 失败" }
# Windows 上 aapt2 -A 会把 assets 条目名写成反斜杠，WebView 会白屏；assets 由下一步手工写。
& "$BT\aapt2.exe" link -o "$Build\base.apk" -I $AndroidJar --manifest (Join-Path $App "AndroidManifest.xml") --min-sdk-version 24 --target-sdk-version 34 --version-code $VersionCode --version-name $Version "$Build\res.zip"
if ($LASTEXITCODE -ne 0) { throw "aapt2 link 失败" }

Write-Host "== 6/8 把 classes.dex 和 assets 塞进 APK =="
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open("$Build\base.apk", [System.IO.Compression.ZipArchiveMode]::Update)
try {
  [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, "$Build\dex\classes.dex", "classes.dex", [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
  foreach ($file in Get-ChildItem "$Build\assets\www" -File) {
    $entryName = "assets/www/" + $file.Name
    $entry = $zip.CreateEntry($entryName, [System.IO.Compression.CompressionLevel]::Optimal)
    $out = $entry.Open()
    try {
      $bytes = [System.IO.File]::ReadAllBytes($file.FullName)
      $out.Write($bytes, 0, $bytes.Length)
    } finally {
      $out.Dispose()
    }
  }
} catch {
  throw ("往 APK 写 entries 失败：" + $_.Exception.Message)
} finally {
  $zip.Dispose()
}
$check = [System.IO.Compression.ZipFile]::OpenRead("$Build\base.apk")
$hasDex = @($check.Entries | Where-Object { $_.FullName -eq "classes.dex" }).Count -gt 0
$check.Dispose()
if (-not $hasDex) { throw "classes.dex 没进 APK" }

Write-Host "== 7/8 zipalign + 检查签名密钥 =="
& "$BT\zipalign.exe" -f 4 "$Build\base.apk" "$Build\aligned.apk"
if ($LASTEXITCODE -ne 0) { throw "zipalign 失败" }
if (-not (Test-Path $Keystore)) {
  if (-not $StorePass) {
    throw "没有签名密钥，也没有设置 DSH_APK_KEYSTORE + DSH_APK_STORE_PASS。见 app/BUILD-APK.md（自用可以直接用旁边的 release APK，不需要自己签）。"
  }
  New-Item -ItemType Directory -Force -Path (Split-Path $Keystore) | Out-Null
  & (Join-Path $JavaHome "bin\keytool.exe") -genkeypair -keystore $Keystore -alias $KeyAlias -keyalg RSA -keysize 2048 -validity 10000 -storepass $StorePass -keypass $StorePass -dname "CN=DSH Pocket Switch, OU=dev, O=shutongX, C=CN" -noprompt
  if ($LASTEXITCODE -ne 0) { throw "keytool 生成密钥失败" }
}
if (-not $StorePass) { throw "签名密钥存在但缺少 DSH_APK_STORE_PASS" }

Write-Host "== 8/8 签名 + 校验 =="
$apk = Join-Path $Dist ("dsh-pocket-switch-app-" + $Version + ".apk")
Remove-Item $apk -Force -ErrorAction SilentlyContinue
& "$BT\apksigner.bat" sign --ks $Keystore --ks-key-alias $KeyAlias --ks-pass ("pass:" + $StorePass) --key-pass ("pass:" + $StorePass) --out $apk "$Build\aligned.apk"
if ($LASTEXITCODE -ne 0) { throw "apksigner sign 失败" }
& "$BT\apksigner.bat" verify --print-certs $apk
if ($LASTEXITCODE -ne 0) { throw "apksigner verify 失败" }

& node $Checker $apk
if ($LASTEXITCODE -ne 0) { throw "APK 条目名检查失败：assets 条目必须用正斜杠" }

& "$BT\aapt2.exe" dump badging $apk | Select-String -Pattern "^package:|sdkVersion|targetSdkVersion|application-label:"
$size = (Get-Item $apk).Length
Write-Host ""
Write-Host ("OK -> " + $apk)
Write-Host ("size: " + [math]::Round($size / 1KB, 1) + " KB")
