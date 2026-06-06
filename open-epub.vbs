Set ws = CreateObject("WScript.Shell")
ws.Run Chr(34) & "C:\Program Files\nodejs\node.exe" & Chr(34) & " " & Chr(34) & "D:\dax\vibe coding\chrome reader\epub-server.js" & Chr(34) & " " & Chr(34) & WScript.Arguments(0) & Chr(34), 0, False
