#!/usr/bin/env bash
# Starts the JamSync backend (FastAPI :8000) and frontend (Vite :5173)
# together, and shuts both down cleanly on Ctrl-C.
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"

# --- backend ---
cd "$ROOT/backend"
if [ ! -d ".venv" ]; then
  echo "Creating Python venv…"
  python3 -m venv .venv
fi
source .venv/bin/activate
pip install -q -r requirements.txt
echo "▶ Starting backend on http://localhost:8000"
uvicorn main:app --port 8000 &
BACKEND_PID=$!

# --- frontend ---
cd "$ROOT/frontend"
if [ ! -d "node_modules" ]; then
  echo "Installing frontend deps…"
  npm install
fi
echo "▶ Starting frontend on http://localhost:5173"
npm run dev &
FRONTEND_PID=$!

# --- cleanup on exit ---
cleanup() {
  echo ""
  echo "Stopping JamSync…"
  kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo ""
echo "JamSync is starting. Open http://localhost:5173"
echo "Press Ctrl-C to stop both servers."
wait
