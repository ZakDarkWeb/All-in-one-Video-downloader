Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")
strPath = FSO.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = strPath

' Check if port 8000 is already active
Set objExec = WshShell.Exec("cmd.exe /c netstat -ano | findstr :8000")
strOut = objExec.StdOut.ReadAll()

If InStr(strOut, "LISTENING") = 0 Then
    ' 0 = Hide window completely (run silently in background)
    WshShell.Run "python -m uvicorn main:app --host 0.0.0.0 --port 8000", 0, False
End If

' Start Cloudflare Public HTTPS Tunnel in background
Set objExec2 = WshShell.Exec("cmd.exe /c tasklist | findstr /i cloudflared.exe")
strOut2 = objExec2.StdOut.ReadAll()
If InStr(strOut2, "cloudflared.exe") = 0 Then
    WshShell.Run "python tunnel_runner.py", 0, False
End If
