' Run auto-update.ps1 without showing a console window (called by the scheduled task).
' ASCII only on purpose: the plugin path may contain Chinese characters, so it is derived at runtime.
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = dir
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & dir & "\auto-update.ps1""", 0, False
