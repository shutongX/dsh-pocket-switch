# 构建 Android App（可选）

这个 App 是一个极简 WebView 壳：把 `app/www/` 里的「我的电脑」页面打包进 APK，断网也能打开；不包含后台服务、不收集数据。

Release 里已经有签好名的 `dsh-pocket-switch-app-<version>.apk`，普通用户直接下载安装即可，不需要构建。

## 自己构建

需要：

- JDK 21（`C:\Program Files\Java\jdk-21`，或设置 `DSH_JAVA_HOME`）
- Android build-tools 34 和 platform-34（见下）
- PowerShell（Windows）

下载工具（只需一次）：

```powershell
$tools = "$env:USERPROFILE\dsh-android"
New-Item -ItemType Directory -Force -Path "$tools\downloads", "$tools\build-tools", "$tools\platform" | Out-Null
curl.exe -L -o "$tools\downloads\build-tools_r34-windows.zip" "https://dl.google.com/android/repository/build-tools_r34-windows.zip"
curl.exe -L -o "$tools\downloads\platform-34-ext7_r03.zip" "https://dl.google.com/android/repository/platform-34-ext7_r03.zip"
tar.exe -xf "$tools\downloads\build-tools_r34-windows.zip" -C "$tools\build-tools"
tar.exe -xf "$tools\downloads\platform-34-ext7_r03.zip" -C "$tools\platform"
```

然后：

```powershell
$env:DSH_ANDROID_TOOLS = "$env:USERPROFILE\dsh-android"
$env:DSH_APK_KEYSTORE = "$env:USERPROFILE\dsh-android\release.jks"
$env:DSH_APK_STORE_PASS = "<你自己设的密码>"
powershell -NoProfile -ExecutionPolicy Bypass -File app\build-apk.ps1
```

首次运行会用 keytool 生成一个自签名 keystore。**保管好它**：同一个包名的升级包必须用同一把钥匙签名。

产物：`dist/dsh-pocket-switch-app-<version>.apk`。

## 装到手机

```powershell
adb install -r dist\dsh-pocket-switch-app-<version>.apk
```

没有 adb 就把 APK 传到手机点开安装（需要允许未知来源）。

## 说明

- App 里的机器列表存在手机本地（localStorage），和 DSH 插件页里的「换电脑」清单是两套数据。
- 插件负责在 DSH 里管理和切换；App 负责在没有 DSH 页面时也能一键打开机器。
- 包名 `com.shutongx.dshphone`，minSdk 24，targetSdk 34，只用 WebView + 本地 HTML。
