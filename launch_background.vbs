Set WshShell = CreateObject("WScript.Shell")
currentDir = "D:\AntiGravity Automation\VS_Desktop_App Old"
WshShell.CurrentDirectory = currentDir

' Check if already listening on port 8767
Set exec = WshShell.Exec("cmd.exe /c netstat -ano | findstr :8767")
output = exec.StdOut.ReadAll()

If InStr(output, "LISTENING") = 0 Then
    ' Start desktop server invisibly in background
    WshShell.Run """C:\Python314\pythonw.exe"" ""D:\AntiGravity Automation\VS_Desktop_App Old\server.py""", 0, False
End If
