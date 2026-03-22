@echo off

echo Stopping Node app...

REM Kill only the window we started (safe)
taskkill /FI "WINDOWTITLE eq MyNodeApp*" /F

echo App stopped.