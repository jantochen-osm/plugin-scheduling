ALTER TABLE schedule_runs ADD COLUMN IF NOT EXISTS "selectedProdIds" jsonb;
ALTER TABLE schedule_runs ADD COLUMN IF NOT EXISTS "runMode" varchar(50) DEFAULT 'FULL';

SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'schedule_runs' 
ORDER BY ordinal_position;
