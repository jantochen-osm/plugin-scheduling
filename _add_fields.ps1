# Add overdueDays field
$v1 = '{"type":"integer","name":"overdueDays","title":"\u903e\u671f\u5929\u6570","defaultValue":0,"interface":"integer","uiSchema":{"type":"number","title":"\u903e\u671f\u5929\u6570","x-component":"InputNumber"}}'
nb api resource create --resource collections.fields --source-id schedule_results_v2 --values $v1 -j

Write-Host ""
Write-Host "---"

# Add overdueType field
$v2 = '{"type":"string","name":"overdueType","title":"\u903e\u671f\u7c7b\u578b","defaultValue":"ON_TIME","interface":"input","uiSchema":{"type":"string","title":"\u903e\u671f\u7c7b\u578b","x-component":"Input"}}'
nb api resource create --resource collections.fields --source-id schedule_results_v2 --values $v2 -j
