Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")
strPath = FSO.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = strPath

' Check if port 8000 is already active
Set objExec = WshShell.Exec("cmd.exe /c netstat -ano | findstr :8000")
strOut = objExec.StdOut.ReadAll()

If InStr(strOut, "LISTENING") = 0 Then
    ' 0 = Hide window completely (run silently in background)
    WshShell.Run "python -m uvicorn main:app --host 127.0.0.1 --port 8000", 0, False
End If
