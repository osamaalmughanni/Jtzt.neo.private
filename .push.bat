@echo off
setlocal

REM Set the desired email address
set EMAIL=o@getify.app

REM Define your remote name (usually 'origin') and branch name
set REMOTE=origin
set BRANCH=main

REM Pull changes from the remote repository
git pull %REMOTE% %BRANCH%

REM Get the current date in the desired format (YYYY-MM-DD)
for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /format:list') do set "dt=%%I"
set "year=%dt:~0,4%"
set "month=%dt:~4,2%"
set "day=%dt:~6,2%"
set "formatted_date=%year%-%month%-%day%"

REM Add all changes and commit with the formatted date and time
git add .
git commit -m "Automated commit: %formatted_date% %TIME%"

REM Set the user email temporarily
git config user.email "%EMAIL%"

REM Push changes to the remote repository
git push %REMOTE% %BRANCH%

REM Display a message indicating the process is complete
echo Repository synced successfully!

pause
