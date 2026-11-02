Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
currentDir = fso.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = currentDir

' Check if already listening on port 8767
Set exec = WshShell.Exec("cmd.exe /c netstat -ano | findstr :8767")
output = exec.StdOut.ReadAll()

If InStr(output, "LISTENING") = 0 Then
    ' Find pythonw executable
    pythonwExe = "C:\Python314\pythonw.exe"
    If Not fso.FileExists(pythonwExe) Then
        pythonwExe = "pythonw.exe"
    End If
    ' Start desktop server invisibly in background (window style 0 = hidden)
    WshShell.Run """" & pythonwExe & """ """ & currentDir & "\server.py""", 0, False
End If
