# JamSync — single-container production image for Render (free tier).
# Stage 1 builds the React frontend; stage 2 serves it from FastAPI alongside
# the API, WebSocket hub, and FLAC streaming — all on one port ($PORT).

# --- stage 1: build the frontend ---
FROM node:20-alpine AS frontend
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install
COPY frontend/ ./
RUN npm run build          # -> /app/dist

# --- stage 2: backend + built frontend ---
FROM python:3.11-slim
WORKDIR /app

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./
# Drop the built SPA where main.py looks for it (backend/static -> /app/static)
COPY --from=frontend /app/dist ./static

# Render injects $PORT; default to 8000 for local runs.
ENV PORT=8000
EXPOSE 8000
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT}"]
