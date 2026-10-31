; Katsudō installer hooks (Tauri NSIS).
; Uninstalling removes the "start with Windows" entry the app may have registered, so no
; dangling sign-in item is left behind. Tracked data and backups stay unless the user ticks
; the uninstaller's "delete application data" box.

!macro NSIS_HOOK_PREUNINSTALL
  ; Stop a running copy so its files can be removed.
  nsExec::Exec 'taskkill /IM katsudo.exe /F'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Katsudo"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "Katsudo"
!macroend
