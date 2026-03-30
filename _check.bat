@echo off
cd /d d:\Users\yotam\Downloads\YMSA
echo === YMSA Environment Check === > _output.log 2>&1
echo. >> _output.log

echo -- Node/npm versions -- >> _output.log
call node --version >> _output.log 2>&1
call npm --version >> _output.log 2>&1
echo. >> _output.log

echo -- Wrangler version -- >> _output.log
call npx wrangler --version >> _output.log 2>&1
echo. >> _output.log

echo -- node_modules? -- >> _output.log
if exist node_modules (echo YES >> _output.log) else (echo MISSING >> _output.log)
echo. >> _output.log

echo -- .secrets.json? -- >> _output.log
if exist .secrets.json (echo YES >> _output.log) else (echo MISSING >> _output.log)
echo. >> _output.log

echo -- .git repo? -- >> _output.log
if exist .git (echo YES >> _output.log) else (echo NO >> _output.log)
echo. >> _output.log

echo -- TypeScript check -- >> _output.log
call npx tsc --noEmit >> _output.log 2>&1
if %ERRORLEVEL% == 0 (echo TSC: PASS >> _output.log) else (echo TSC: FAIL >> _output.log)
echo. >> _output.log

echo -- npm install check -- >> _output.log
call npm ls --depth=0 >> _output.log 2>&1
echo. >> _output.log

echo === DONE === >> _output.log
echo Check complete! Output saved to _output.log
