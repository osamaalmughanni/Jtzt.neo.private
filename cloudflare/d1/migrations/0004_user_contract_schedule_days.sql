PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS user_contract_schedule_days (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_id INTEGER NOT NULL,
  weekday INTEGER NOT NULL CHECK(weekday BETWEEN 1 AND 7),
  is_working_day INTEGER NOT NULL DEFAULT 0,
  start_time TEXT,
  end_time TEXT,
  minutes INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (contract_id) REFERENCES user_contracts(id) ON DELETE CASCADE,
  UNIQUE(contract_id, weekday)
);

CREATE INDEX IF NOT EXISTS idx_user_contract_schedule_days_contract
ON user_contract_schedule_days (contract_id, weekday);

DELETE FROM user_contract_schedule_days;

WITH RECURSIVE weekdays(day) AS (
  SELECT 1
  UNION ALL
  SELECT day + 1 FROM weekdays WHERE day < 7
)
INSERT INTO user_contract_schedule_days (
  contract_id,
  weekday,
  is_working_day,
  start_time,
  end_time,
  minutes
)
SELECT
  uc.id,
  weekdays.day,
  CASE
    WHEN weekdays.day <= 5 AND ROUND(uc.hours_per_week * 60.0 / 5.0) > 0 THEN 1
    ELSE 0
  END,
  CASE
    WHEN weekdays.day <= 5 AND ROUND(uc.hours_per_week * 60.0 / 5.0) > 0 THEN '09:00'
    ELSE NULL
  END,
  CASE
    WHEN weekdays.day <= 5 AND ROUND(uc.hours_per_week * 60.0 / 5.0) > 0 THEN time('09:00', printf('+%d minutes', CAST(ROUND(uc.hours_per_week * 60.0 / 5.0) AS INTEGER)))
    ELSE NULL
  END,
  CASE
    WHEN weekdays.day <= 5 AND ROUND(uc.hours_per_week * 60.0 / 5.0) > 0 THEN CAST(ROUND(uc.hours_per_week * 60.0 / 5.0) AS INTEGER)
    ELSE 0
  END
FROM user_contracts uc
CROSS JOIN weekdays
WHERE NOT EXISTS (
  SELECT 1
  FROM user_contract_schedule_days existing
  WHERE existing.contract_id = uc.id
    AND existing.weekday = weekdays.day
);

PRAGMA foreign_keys = ON;
