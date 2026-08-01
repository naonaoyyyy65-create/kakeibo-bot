#!/bin/bash
# Health check monitor for kakeibo-bot. Run via cron every few minutes.
LOG=/home/<user>/apps/kakeibo-bot/health.log
if [ ! -f "$LOG" ]; then
  echo "timestamp,status,http_code" > "$LOG"
fi
TS=$(date "+%Y-%m-%d %H:%M:%S")
CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:3000/health)
if [ "$CODE" = "200" ]; then
  echo "$TS,ok,$CODE" >> "$LOG"
else
  echo "$TS,fail,$CODE" >> "$LOG"
fi
