; Aurora Game Installer (Inno Setup 7)
; Собирает портативную версию Aurora Game в установщик Windows.

#define MyAppName "Aurora Game"
#define MyAppPublisher "efremov-aa"
#define MyAppURL "https://github.com/efremov-aa/aurora-game-client"
#define MyAppVersion "1.4.49"
#define MyAppExeName "AuroraGame.exe"

[Setup]
AppId={{6C5F2A91-3D4E-4B8A-9C7F-2E1D5A6B3C8F}}
AppName={#MyAppName}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
AppVersion={#MyAppVersion}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
AllowNoIcons=yes
LicenseFile=
OutputDir=output
OutputBaseFilename=AuroraGame-Setup-{#MyAppVersion}
Compression=lzma
SolidCompression=yes
PrivilegesRequired=admin
PrivilegesRequiredOverridesAllowed=dialog
UninstallDisplayIcon={app}\{#MyAppExeName}

[Languages]
Name: "russian"; MessagesFile: "compiler:Languages\Russian.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked
Name: "quicklaunchicon"; Description: "{cm:CreateQuickLaunchIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
; Путь относительный: каталог сборки ищется рядом с installer\, без локальных абсолютных путей.
Source: "..\electron\dist\AuroraGame-win32-x64\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs
; В сборку входит sidecar LiveKit (resources\app\win\livekit\livekit-server.exe).
; Он запускается только на 127.0.0.1 локально; для голоса между разными сетями
; клиент автоматически подключается к публичному медиасерверу (см. VOICE_SERVER.md).

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\{cm:UninstallProgram,#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent
