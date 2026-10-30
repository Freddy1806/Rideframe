#!/bin/bash
# Doppelklick auf dem Mac: startet RIDEFRAME und öffnet Chrome.
cd "$(dirname "$0")"
PORT=8765
if ! lsof -i :$PORT >/dev/null 2>&1; then
  NODE=$(command -v node || ls ~/.local/node/bin/node 2>/dev/null)
  if [ -n "$NODE" ]; then "$NODE" serve.mjs & else python3 -m http.server $PORT --bind 127.0.0.1 & fi
  sleep 1
fi
open -a "Google Chrome" "http://localhost:$PORT" 2>/dev/null || open "http://localhost:$PORT"
wait
