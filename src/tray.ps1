# Ponisha Notifier — system tray host.
# Protocol:
#   stdout (this -> node):  CLICK_CHECK | CLICK_EXIT
#   stdin  (node -> this):  TOOLTIP <text>
#                           BALLOON <title>\t<text>
#                           EXIT
# Draws its own icon (white "Po" on a green circle) so no asset file is needed.

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

function New-PoIcon {
  $size = 32
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $g.Clear([System.Drawing.Color]::Transparent)
  $green = [System.Drawing.Color]::FromArgb(255, 34, 168, 84)
  $brush = New-Object System.Drawing.SolidBrush($green)
  $g.FillEllipse($brush, 0, 0, ($size - 1), ($size - 1))
  $font = New-Object System.Drawing.Font('Segoe UI', 14, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
  $sf = New-Object System.Drawing.StringFormat
  $sf.Alignment = [System.Drawing.StringAlignment]::Center
  $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
  $rect = New-Object System.Drawing.RectangleF(0, -1, $size, $size)
  $g.DrawString('Po', $font, $white, $rect, $sf)
  $g.Dispose()
  $hicon = $bmp.GetHicon()
  return [System.Drawing.Icon]::FromHandle($hicon)
}

$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = New-PoIcon
$notify.Text = 'Ponisha Notifier'
$notify.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$itemCheck = $menu.Items.Add('Check now')
$itemExit = $menu.Items.Add('Exit')
$notify.ContextMenuStrip = $menu

$emit = { param($line) [Console]::Out.WriteLine($line); [Console]::Out.Flush() }

$itemCheck.Add_Click({ & $emit 'CLICK_CHECK' })
$notify.Add_MouseDoubleClick({ & $emit 'CLICK_CHECK' })
$itemExit.Add_Click({
  & $emit 'CLICK_EXIT'
  $notify.Visible = $false
  [System.Windows.Forms.Application]::Exit()
})

# --- Non-blocking stdin reader (async ReadAsync polled by a UI timer) --------
$script:stdin = [Console]::OpenStandardInput()
$script:buf = New-Object byte[] 4096
$script:sb = New-Object System.Text.StringBuilder
$script:readTask = $null
function Start-Read { $script:readTask = $script:stdin.ReadAsync($script:buf, 0, $script:buf.Length) }

function Invoke-Command2 {
  param($line)
  $line = $line.TrimEnd("`r")
  if ($line -eq 'EXIT') {
    $notify.Visible = $false
    [System.Windows.Forms.Application]::Exit()
  }
  elseif ($line -like 'TOOLTIP *') {
    $t = $line.Substring(8)
    if ($t.Length -gt 63) { $t = $t.Substring(0, 63) }  # NotifyIcon.Text hard limit
    $notify.Text = $t
  }
  elseif ($line -like 'BALLOON *') {
    $rest = $line.Substring(8)
    $parts = $rest -split "`t", 2
    $title = $parts[0]
    $text = if ($parts.Count -gt 1) { $parts[1] } else { '' }
    $notify.ShowBalloonTip(6000, $title, $text, [System.Windows.Forms.ToolTipIcon]::Info)
  }
}

Start-Read
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 150
$timer.Add_Tick({
  if ($script:readTask -and $script:readTask.IsCompleted) {
    $n = 0
    try { $n = $script:readTask.Result } catch { $n = 0 }
    if ($n -le 0) {
      # Parent closed stdin (node exited) -> shut down the tray too.
      $notify.Visible = $false
      [System.Windows.Forms.Application]::Exit()
      return
    }
    $text = [System.Text.Encoding]::UTF8.GetString($script:buf, 0, $n)
    [void]$script:sb.Append($text)
    $all = $script:sb.ToString()
    $lines = $all -split "`n"
    $script:sb.Clear() | Out-Null
    [void]$script:sb.Append($lines[$lines.Count - 1])  # keep trailing partial line
    for ($i = 0; $i -lt $lines.Count - 1; $i++) { Invoke-Command2 $lines[$i] }
    Start-Read
  }
})
$timer.Start()

try {
  [System.Windows.Forms.Application]::Run()
}
finally {
  $notify.Visible = $false
  $notify.Dispose()
}
