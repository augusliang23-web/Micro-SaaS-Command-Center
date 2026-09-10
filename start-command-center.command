#!/bin/bash
# Double-click this file to start Micro-SaaS Command Center and open it in your browser.
# Resolves symlinks (e.g. a Desktop shortcut) so it always runs from the real project folder.
SOURCE="${BASH_SOURCE[0]}"
while [ -h "$SOURCE" ]; do
  DIR="$(cd -P "$(dirname "$SOURCE")" >/dev/null 2>&1 && pwd)"
  SOURCE="$(readlink "$SOURCE")"
  [[ $SOURCE != /* ]] && SOURCE="$DIR/$SOURCE"
done
cd "$(cd -P "$(dirname "$SOURCE")" >/dev/null 2>&1 && pwd)"

echo "正在啟動 Command Center..."
npm run dev &
SERVER_PID=$!

# Give the server a moment to boot before opening the browser
sleep 3
open "http://127.0.0.1:3000"

echo ""
echo "Command Center 正在執行中。"
echo "要關閉它，請關掉這個視窗，或按 Ctrl+C。"
echo ""

wait $SERVER_PID
