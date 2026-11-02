; Offox installer for Windows. Lets you choose:
;   Normal install   - Offox for your user account (no administrator rights
;                      needed), Start menu and desktop shortcuts, uninstaller,
;                      settings kept in your user profile (%APPDATA%\Mozilla\Offox).
;   Portable install - Offox and all of its settings in one folder you choose
;                      (for example on a USB drive). Nothing is written to the
;                      registry or anywhere else.
;
; Built by installer\build-windows.ps1:
;   makensis /DSTAGE=<unpacked "mach package" folder> /DVERSION=153.5.1 /DOUTFILE=Offox-Setup.exe offox.nsi
; It also builds on Linux (CI cross-compiles Windows Offox; see
; offox/installer/build-windows-on-linux.sh).
;
; Silent installs:
;   Offox-Setup.exe /S                         normal install
;   Offox-Setup.exe /S /PORTABLE /D=E:\Offox   portable install (/D must be last)

Unicode true
SetCompressor /SOLID lzma
RequestExecutionLevel user
ManifestDPIAware true

!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "x64.nsh"

!ifndef STAGE
  !error "Pass /DSTAGE=<folder containing offox.exe>"
!endif
!ifndef VERSION
  !define VERSION "0.0"
!endif
; VIProductVersion needs exactly four numbers (153.5.1 -> 153.5.1.0).
!ifndef VIVERSION
  !searchparse /noerrors "${VERSION}.0.0.0.0" "" VI1 "." VI2 "." VI3 "." VI4 "."
  !define VIVERSION "${VI1}.${VI2}.${VI3}.${VI4}"
!endif
!ifndef OUTFILE
  !define OUTFILE "Offox-${VERSION}-Setup.exe"
!endif

!define APPNAME "Offox"
!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\Offox"
!define BRANDING "${__FILEDIR__}/../../../browser/branding/offox"

Name "${APPNAME}"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Programs\Offox"
BrandingText "Offox ${VERSION}"
VIProductVersion "${VIVERSION}"
VIAddVersionKey "ProductName" "Offox"
VIAddVersionKey "FileDescription" "Offox installer"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "MPL 2.0 / MIT"

!define MUI_ICON "${BRANDING}/firefox.ico"
!define MUI_UNICON "${BRANDING}/firefox.ico"
!define MUI_WELCOMEFINISHPAGE_BITMAP "${BRANDING}/wizWatermark.bmp"
!define MUI_UNWELCOMEFINISHPAGE_BITMAP "${BRANDING}/wizWatermark.bmp"
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_RIGHT
!define MUI_HEADERIMAGE_BITMAP "${BRANDING}/wizHeader.bmp"
!define MUI_ABORTWARNING

Var Portable          ; "1" for a portable install
Var NormalRadio
Var PortableRadio
Var DesktopShortcut
Var DesktopCheckbox

; ---------------------------------------------------------------- pages

!define MUI_WELCOMEPAGE_TITLE "Install Offox"
!define MUI_WELCOMEPAGE_TEXT "Offox is a web browser that never goes on the internet. Your websites live in folders on this computer or on a USB drive, at addresses you choose.$\r$\n$\r$\nOn the next page you can choose a normal install or a portable install."
!insertmacro MUI_PAGE_WELCOME
Page custom InstallTypePage InstallTypeLeave
!define MUI_PAGE_CUSTOMFUNCTION_PRE DirectoryPre
!define MUI_DIRECTORYPAGE_TEXT_TOP "$(DirText)"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\offox.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Start Offox now"
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

LangString DirText ${LANG_ENGLISH} "Choose the folder for Offox."

; ---------------------------------------------------------- functions

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "Offox needs a 64-bit version of Windows."
    Abort
  ${EndIf}
  StrCpy $Portable "0"
  StrCpy $DesktopShortcut ${BST_CHECKED}
  ${GetParameters} $0
  ClearErrors
  ${GetOptions} $0 "/PORTABLE" $1
  ${IfNot} ${Errors}
    StrCpy $Portable "1"
    ; Keep a /D= given on the command line; otherwise suggest a folder.
    StrCmp $INSTDIR "$LOCALAPPDATA\Programs\Offox" 0 +2
      StrCpy $INSTDIR "$DESKTOP\Offox Portable"
  ${EndIf}
FunctionEnd

Function InstallTypePage
  !insertmacro MUI_HEADER_TEXT "Installation type" "Choose how Offox should be installed."
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateRadioButton} 0 0 100% 12u "&Normal install"
  Pop $NormalRadio
  ${NSD_CreateLabel} 14u 13u -14u 26u "Offox is installed for your Windows account, with Start menu and desktop shortcuts and an uninstaller. Its settings are kept in your user profile."
  Pop $0
  ${NSD_CreateCheckbox} 14u 40u -14u 12u "Create a &desktop shortcut"
  Pop $DesktopCheckbox

  ${NSD_CreateRadioButton} 0 62u 100% 12u "&Portable install"
  Pop $PortableRadio
  ${NSD_CreateLabel} 14u 75u -14u 36u "Offox and all of its settings are kept in one folder that you can carry around, for example on a USB drive. Nothing is written to the registry or anywhere else on this computer. To remove it, delete the folder."
  Pop $0

  ${If} $Portable == "1"
    ${NSD_Check} $PortableRadio
    EnableWindow $DesktopCheckbox 0
  ${Else}
    ${NSD_Check} $NormalRadio
  ${EndIf}
  ${If} $DesktopShortcut == ${BST_CHECKED}
    ${NSD_Check} $DesktopCheckbox
  ${EndIf}
  ${NSD_OnClick} $NormalRadio InstallTypeChanged
  ${NSD_OnClick} $PortableRadio InstallTypeChanged
  nsDialogs::Show
FunctionEnd

Function InstallTypeChanged
  Pop $0
  ${NSD_GetState} $PortableRadio $1
  ${If} $1 == ${BST_CHECKED}
    EnableWindow $DesktopCheckbox 0
  ${Else}
    EnableWindow $DesktopCheckbox 1
  ${EndIf}
FunctionEnd

Function InstallTypeLeave
  ${NSD_GetState} $DesktopCheckbox $DesktopShortcut
  ${NSD_GetState} $PortableRadio $0
  ${If} $0 == ${BST_CHECKED}
    ${If} $Portable != "1"
      StrCpy $INSTDIR "$DESKTOP\Offox Portable"
    ${EndIf}
    StrCpy $Portable "1"
  ${Else}
    ${If} $Portable == "1"
      StrCpy $INSTDIR "$LOCALAPPDATA\Programs\Offox"
    ${EndIf}
    StrCpy $Portable "0"
  ${EndIf}
FunctionEnd

Function DirectoryPre
  ${If} $Portable == "1"
    !insertmacro MUI_HEADER_TEXT "Portable install" "Choose where to put Offox, for example a USB drive (E:\Offox)."
  ${Else}
    !insertmacro MUI_HEADER_TEXT "Normal install" "Choose where to install Offox."
  ${EndIf}
FunctionEnd

; Offox always gets a folder of its own (E:\ becomes E:\Offox), so the
; uninstaller can safely remove the whole folder.
Function EnsureOffoxFolder
  StrCpy $0 $INSTDIR "" -5
  StrCpy $1 $INSTDIR "" -14
  ${If} $0 != "Offox"
  ${AndIf} $1 != "Offox Portable"
    ${If} $INSTDIR != ""
      StrCpy $2 $INSTDIR "" -1
      ${If} $2 == "\"
        StrCpy $INSTDIR "$INSTDIROffox"
      ${Else}
        StrCpy $INSTDIR "$INSTDIR\Offox"
      ${EndIf}
    ${EndIf}
  ${EndIf}
FunctionEnd

; ------------------------------------------------------------ sections

Section "Offox" SecMain
  SectionIn RO
  Call EnsureOffoxFolder
  SetOutPath "$INSTDIR"
  File /r "${STAGE}/*.*"

  !if /FileExists "${__FILEDIR__}/ffmpeg/ffmpeg.exe"
    ; Optional: an LGPL build of FFmpeg for converting old video formats.
    SetOutPath "$INSTDIR\ffmpeg"
    File /r "${__FILEDIR__}/ffmpeg/*.*"
    SetOutPath "$INSTDIR"
  !endif

  ${If} $Portable == "1"
    ; The marker tells Offox to keep its profile in Data\ next to offox.exe.
    FileOpen $0 "$INSTDIR\offox-portable" w
    FileWrite $0 "Offox portable install: settings are stored in the Data folder.$\r$\n"
    FileClose $0
    CreateDirectory "$INSTDIR\Data"
    CreateDirectory "$INSTDIR\Sites"
  ${Else}
    Delete "$INSTDIR\offox-portable"
    WriteUninstaller "$INSTDIR\Uninstall Offox.exe"
    CreateShortCut "$SMPROGRAMS\Offox.lnk" "$INSTDIR\offox.exe"
    ${If} $DesktopShortcut == ${BST_CHECKED}
      CreateShortCut "$DESKTOP\Offox.lnk" "$INSTDIR\offox.exe"
    ${EndIf}
    WriteRegStr HKCU "${UNINSTKEY}" "DisplayName" "Offox"
    WriteRegStr HKCU "${UNINSTKEY}" "DisplayVersion" "${VERSION}"
    WriteRegStr HKCU "${UNINSTKEY}" "Publisher" "Offox"
    WriteRegStr HKCU "${UNINSTKEY}" "DisplayIcon" "$INSTDIR\offox.exe,0"
    WriteRegStr HKCU "${UNINSTKEY}" "InstallLocation" "$INSTDIR"
    WriteRegStr HKCU "${UNINSTKEY}" "UninstallString" '"$INSTDIR\Uninstall Offox.exe"'
    WriteRegStr HKCU "${UNINSTKEY}" "QuietUninstallString" '"$INSTDIR\Uninstall Offox.exe" /S'
    WriteRegDWORD HKCU "${UNINSTKEY}" "NoModify" 1
    WriteRegDWORD HKCU "${UNINSTKEY}" "NoRepair" 1
    ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
    IntFmt $0 "0x%08X" $0
    WriteRegDWORD HKCU "${UNINSTKEY}" "EstimatedSize" "$0"
  ${EndIf}
SectionEnd

Section "Uninstall"
  nsExec::Exec 'taskkill /F /IM offox.exe'
  Delete "$SMPROGRAMS\Offox.lnk"
  Delete "$DESKTOP\Offox.lnk"
  DeleteRegKey HKCU "${UNINSTKEY}"
  ; Only the program is removed: settings (%APPDATA%\Mozilla\Offox) and your
  ; websites (storage folders) are kept.
  RMDir /r "$INSTDIR"
SectionEnd
