Write-Host "=== 1. Order ZMO00007234 ==="
$filter1 = '{"ProdId":"ZMO00007234"}'
nb api resource list --resource production_orders --filter $filter1 -j

Write-Host ""
Write-Host "=== 2. Schedule result ==="
$filter2 = '{"prodId":"ZMO00007234"}'
nb api resource list --resource schedule_results_v2 --filter $filter2 -j

Write-Host ""
Write-Host "=== 3. Route operations for item ==="
# First get the ItemId from the order, then query routes
# For now query all routes and filter
$orderData = nb api resource list --resource production_orders --filter $filter1 -j | ConvertFrom-Json
$itemId = $orderData.data[0].ItemId
Write-Host "ItemId: $itemId"
$filter3 = "{`"fg_item_code`":`"$itemId`"}"
nb api resource list --resource route_operation --filter $filter3 -j

Write-Host ""
Write-Host "=== 4. Calendar 05-19 ==="
$filter4 = '{"calendarDate":"2026-05-19"}'
nb api resource list --resource md_work_calendars --filter $filter4 -j
