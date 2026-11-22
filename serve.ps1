$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

$socket = New-Object System.Net.Sockets.TcpListener ([System.Net.IPAddress]::Loopback), 0
$socket.Start()
$port = $socket.LocalEndpoint.Port
$socket.Stop()

$listener = New-Object System.Net.HttpListener
$url = "http://127.0.0.1:$port/"
$listener.Prefixes.Add($url)

try {
    $listener.Start()
    Write-Host "Anime After Hours is running at $url"
    Write-Host 'Keep this window open while playing. Close it to stop the game.'
    Start-Process $url

    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $response = $context.Response
        $stream = $null

        try {
            $path = [Uri]::UnescapeDataString($context.Request.Url.AbsolutePath)
            $file = $null
            $contentType = 'application/octet-stream'
            switch -Regex ($path) {
                '^/$|^/index\.html$' { $file = Join-Path $root 'index.html'; $contentType = 'text/html; charset=utf-8'; break }
                '^/app\.js$' { $file = Join-Path $root 'app.js'; $contentType = 'text/javascript; charset=utf-8'; break }
                '^/styles\.css$' { $file = Join-Path $root 'styles.css'; $contentType = 'text/css; charset=utf-8'; break }
                '^/source/GuestAnime\.csv$' { $file = Join-Path $root 'source\GuestAnime.csv'; $contentType = 'text/csv; charset=utf-8'; break }
                '^/source/(music|frames)/([^/\\]+)$' {
                    $folder = $Matches[1]
                    $name = $Matches[2]
                    $extension = [IO.Path]::GetExtension($name)
                    if (($folder -eq 'music' -and $extension -eq '.mp3') -or
                        ($folder -eq 'frames' -and $extension -eq '.jpg')) {
                        $file = Join-Path (Join-Path $root "source\$folder") $name
                        $contentType = if ($folder -eq 'music') { 'audio/mpeg' } else { 'image/jpeg' }
                    }
                    break
                }
            }

            if ($context.Request.HttpMethod -notin @('GET', 'HEAD')) {
                $response.StatusCode = 405
            } elseif (-not $file -or -not (Test-Path -LiteralPath $file -PathType Leaf)) {
                $response.StatusCode = 404
            } else {
                $stream = [IO.File]::OpenRead($file)
                $length = $stream.Length
                [long]$start = 0
                [long]$end = $length - 1
                $response.ContentType = $contentType
                $response.Headers.Add('Accept-Ranges', 'bytes')
                $range = $context.Request.Headers['Range']
                if ($range) {
                    if ($range -notmatch '^bytes=(\d*)-(\d*)$' -or
                        (-not $Matches[1] -and -not $Matches[2]) -or $length -eq 0) {
                        $response.StatusCode = 416
                    } else {
                        if (-not $Matches[1]) {
                            [long]$suffix = $Matches[2]
                            $start = [Math]::Max(0, $length - $suffix)
                        } else {
                            $start = [long]$Matches[1]
                            if ($Matches[2]) { $end = [Math]::Min($end, [long]$Matches[2]) }
                        }
                        if ($start -ge $length -or $start -gt $end) {
                            $response.StatusCode = 416
                        } else {
                            $response.StatusCode = 206
                            $response.Headers.Add('Content-Range', "bytes $start-$end/$length")
                        }
                    }
                }
                if ($response.StatusCode -eq 416) {
                    $response.Headers.Add('Content-Range', "bytes */$length")
                } else {
                    [long]$remaining = $end - $start + 1
                    $response.ContentLength64 = $remaining
                    if ($context.Request.HttpMethod -eq 'GET') {
                        $stream.Position = $start
                        $buffer = New-Object byte[] 65536
                        while ($remaining -gt 0) {
                            $read = $stream.Read($buffer, 0, [int][Math]::Min($buffer.Length, $remaining))
                            if ($read -eq 0) { throw 'Unexpected end of file.' }
                            $response.OutputStream.Write($buffer, 0, $read)
                            $remaining -= $read
                        }
                    }
                }
            }
        } catch {
            Write-Warning "Request failed: $($_.Exception.Message)"
            try { $response.StatusCode = 500 } catch { Write-Warning $_.Exception.Message }
        } finally {
            if ($stream) { $stream.Dispose() }
            $response.Close()
        }
    }
} catch {
    Write-Error "Could not start the local game server: $($_.Exception.Message)" -ErrorAction Continue
    exit 1
} finally {
    $listener.Close()
}
