#!/bin/bash
# エモリー 基本テストパック ランナー。
# ビルド → ローカル配信 → ヘッドレス Chrome で pack.js を実行 → 後片付け。
# 使い方:  bash e2e/run.sh   （リポジトリ直下から）
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PORT=8099
PACK_DIR="$ROOT/e2e"

# puppeteer を e2e/ 内に用意（無ければ取得。Chrome は storage.googleapis.com から）
if [ ! -d "$PACK_DIR/node_modules/puppeteer" ]; then
  echo "[e2e] installing puppeteer ..."
  ( cd "$PACK_DIR" && npm install --no-audit --no-fund >/tmp/e2e_npm.log 2>&1 ) || { echo "[e2e] npm install failed"; tail -5 /tmp/e2e_npm.log; exit 2; }
fi

# ビルド（dist が無い/古い時は --build で強制）
if [ "${1:-}" = "--build" ] || [ ! -f dist/index.html ]; then
  echo "[e2e] expo export ..."
  rm -rf dist && EXPO_OFFLINE=1 CI=1 timeout 360 npx expo export --platform web >/tmp/e2e_export.log 2>&1 || { echo "[e2e] export failed"; tail -6 /tmp/e2e_export.log; exit 2; }
fi

pkill -f "http.server $PORT" 2>/dev/null || true
rm -rf /tmp/e2e_serve && mkdir -p /tmp/e2e_serve && ln -s "$ROOT/dist" /tmp/e2e_serve/Emory
( cd /tmp/e2e_serve && nohup python3 -m http.server $PORT >/tmp/e2e_serve.log 2>&1 & )
sleep 2

node "$PACK_DIR/pack.js" "http://localhost:$PORT/Emory/"
RC=$?
pkill -f "http.server $PORT" 2>/dev/null || true
echo "[e2e] done rc=$RC"
exit $RC
