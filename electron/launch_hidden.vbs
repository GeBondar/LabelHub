' LabelHub — launches the app with no visible console window.
' Runs launch.cmd hidden (window style 0); the Electron GUI window still appears.
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = scriptDir
sh.Run """" & scriptDir & "\launch.cmd""", 0, False
