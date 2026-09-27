# One-off (Phase 0, not shipped). Drives desktop Excel from scenarios.json.
#   -BuildTemplate            : real workbook + template.set -> docs/plan_financier.template.xlsx (anonymized)
#   -OutDir <dir> [-Only id]  : template + patches (xx.xx rounding) -> <dir>/_patched.xlsx,
#                               then each scenario's overrides -> <dir>/<id>.xlsx (recalculated)
param([string]$OutDir, [switch]$BuildTemplate, [string]$Only)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$spec = Get-Content (Join-Path $PSScriptRoot 'scenarios.json') -Raw -Encoding UTF8 | ConvertFrom-Json

function Full($rel) { [IO.Path]::GetFullPath((Join-Path $root $rel)) }  # Excel COM rejects '/' paths

function Set-Ops($wb, $ops) {
    foreach ($op in $ops) {
        $rng = $wb.Worksheets.Item([int]$op[0]).Range([string]$op[1])
        $v = $op[2]
        if ($null -eq $v) { $rng.ClearContents() | Out-Null }
        elseif ($v -is [string] -and $v.StartsWith('date:')) { $rng.Value2 = ([datetime]::ParseExact($v.Substring(5), 'yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture)).ToOADate() }
        elseif ($v -is [string]) { $rng.Formula = [string]$v }
        else { $rng.Value2 = [double]$v }
    }
}

$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false
$xl.DisplayAlerts = $false
try {
    if ($BuildTemplate) {
        $wb = $xl.Workbooks.Open((Full $spec.template.source), 0, $true)
        Set-Ops $wb $spec.template.set
        $xl.CalculateFull()
        $out = Full $spec.template.out
        $wb.SaveAs($out, 51); $wb.Close($false)
        "saved $out"
        return
    }
    if (-not $OutDir) { throw '-OutDir is required' }
    New-Item -ItemType Directory -Force $OutDir | Out-Null

    # 1. xx.xx rounding patches, applied once
    $OutDir = [IO.Path]::GetFullPath($OutDir)
    $patched = Join-Path $OutDir '_patched.xlsx'
    $wb = $xl.Workbooks.Open((Full $spec.template.out), 0, $true)
    foreach ($p in $spec.patches) {
        $ws = $wb.Worksheets.Item([int]$p[0])
        $cell = $ws.Range([string]$p[1])
        if ($p.Count -ge 4) { $cell.Formula = [string]$p[3] }
        else { $cell.Formula = '=ROUND(' + $cell.Formula.Substring(1) + ',2)' }
        if ($null -ne $p[2]) { $ws.Range([string]$p[1] + ':' + [string]$p[2]).FillDown() | Out-Null }
    }
    $xl.CalculateFull()
    $wb.SaveAs($patched, 51); $wb.Close($false)
    "saved $patched"

    # 2. scenarios
    foreach ($s in $spec.scenarios) {
        if ($Only -and $s.id -ne $Only) { continue }
        if ($s.set -is [string]) { "skip $($s.id) (set not generated yet)"; continue }
        $wb = $xl.Workbooks.Open($patched, 0, $true)
        Set-Ops $wb $s.set
        $xl.CalculateFull()
        $out = Join-Path $OutDir ($s.id + '.xlsx')
        $wb.SaveAs($out, 51); $wb.Close($false)
        "saved $out"
    }
}
finally {
    $xl.Quit()
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($xl) | Out-Null
}
