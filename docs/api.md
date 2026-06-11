# Scheduling API

## POST /api/scheduling:unlockAllByRunId

批量解锁指定版本内的所有手工调整记录。

### Request Body

```json
{
  "runId": "RUN_1781072874174"
}
```

### Response

```json
{
  "success": true,
  "runId": "RUN_1781072874174",
  "unlockedCount": 12
}
```

### Notes

- 仅影响 `runId` 对应版本内的记录。
- 只会解锁 `isManualAdjusted=true` 的记录。
- 该接口用于“解锁全部并重排”前置步骤，随后应调用 `scheduling:reScheduleAfterAdjust`。