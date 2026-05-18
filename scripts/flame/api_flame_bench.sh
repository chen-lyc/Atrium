#!/bin/bash
# API 火焰图压测 — 全量 API 覆盖
# 用法: cd ~/WebServer/scripts/flame && bash api_flame_bench.sh

set -uo pipefail

# ── Mode ──
#   flame   perf + oha + flamegraph（默认）
#   full    oha 干净压测 → 重新播种 → perf + oha + flamegraph
MODE="${1:-flame}"
if [ "$MODE" != "flame" ] && [ "$MODE" != "full" ]; then
  echo "Usage: bash api_flame_bench.sh [flame|full]"
  echo "  flame  仅火焰图压测（默认）"
  echo "  full   先生成干净 RPS 数据（简历用），再生成火焰图"
  exit 1
fi

TEST_USER="test"
TEST_PASS="123"
CONC=20

BASE="http://127.0.0.1:8080"
OHA=$(command -v oha)
SVG_DIR="$HOME/WebServer/flame_graphs/svg"
LOG_DIR="$HOME/WebServer/flame_graphs/logs"
BENCH_DIR="$HOME/WebServer/flame_graphs/bench"
AGENT_DIR="$HOME/WebServer/flame_graphs/agent_data"
FG="$HOME/FlameGraph"
MYSQL="sudo /usr/bin/mysql webserver"

/usr/bin/mkdir -p "$SVG_DIR" "$LOG_DIR" "$BENCH_DIR" "$AGENT_DIR"

# ── PID: 只取监听 8080 的 worker 进程，跳过守护进程 ──
PID=$(/usr/bin/fuser 8080/tcp 2>/dev/null | /usr/bin/grep -o '[0-9]\+' | /usr/bin/head -1)
if [ -z "$PID" ]; then
  echo "ERROR: 没有进程监听 8080 端口，请先启动 server.out"
  exit 1
fi
echo "PID=$PID"

# ── perf_event_paranoid: 云服务器默认 4 会禁用采样，临时降到 1 ──
PARANOID_OLD=$(cat /proc/sys/kernel/perf_event_paranoid 2>/dev/null)
if [ -n "$PARANOID_OLD" ] && [ "$PARANOID_OLD" -gt 1 ]; then
  echo "perf_event_paranoid=$PARANOID_OLD → 设为 1（退出时恢复）"
  /usr/bin/sudo /sbin/sysctl -q kernel.perf_event_paranoid=1
fi

# ── 动态用户名 ──
REG_USER="bench_$(date +%s)"
REG_BODY="username=${REG_USER}&password=noop123"

# HTML 汇总页
BENCH_HTML="$HOME/WebServer/flame_graphs/bench.html"
FLAME_HTML="$HOME/WebServer/flame_graphs/index.html"

write_html_header() {
  local title="$1"; local file="$2"
  /usr/bin/cat > "$file" << HTMLEOF
<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font:14px monospace;margin:20px;background:#111;color:#ddd}
table{border-collapse:collapse;width:100%}th,td{padding:6px 10px;text-align:right;border-bottom:1px solid #333}
th{background:#222;color:#fff}td:first-child,th:first-child,td:nth-child(2),th:nth-child(2){text-align:left}
a{color:#4af;text-decoration:none}a:hover{text-decoration:underline}</style></head><body>
<h2>${title}</h2>
<p style="color:#888;margin-bottom:16px">${3:-}</p>
<table><tr><th>API</th><th>Method</th><th>URL</th><th>RPS</th><th>p50</th><th>p90</th><th>p99</th><th>Success</th><th>Total</th>${4:-}</tr>
HTMLEOF
}

# ═══════════════════════════════════════
# 1. 登录 & 获取参数
# ═══════════════════════════════════════
echo "=== Login ==="
TOKEN=$(/usr/bin/curl -s -i -X POST \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=$TEST_USER&password=$TEST_PASS" \
  "$BASE/api/login" | /usr/bin/grep -oP 'session_id=\K[a-f0-9]+' | /usr/bin/head -1)
COOKIE="session_id=$TOKEN"
echo "OK"

echo "=== Params ==="
# 先获取 user_id
ME=$(/usr/bin/curl -s -b "$COOKIE" "$BASE/api/me")
USER_ID=$(echo "$ME" | /usr/bin/jq -r '.user_id // "0"')
[ "$USER_ID" = "null" ] && USER_ID="0"
echo "user=$USER_ID"

# 确保公共房间存在（需要先有 user_id 作为 owner），三步事务
if [ "$USER_ID" != "0" ]; then
  $MYSQL -e "
    INSERT IGNORE INTO rooms (id, name, main_conversation_id, owner_id, created_at_ms, type) 
    VALUES (1, 'public', 0, ${USER_ID}, 0, 1)" 2>/dev/null || true
  $MYSQL -e "
    INSERT IGNORE INTO conversations (id, room_id, title, created_by, created_at_ms)
    VALUES (1, 1, 'public', ${USER_ID}, 0)" 2>/dev/null || true
  $MYSQL -e "
    UPDATE rooms SET main_conversation_id = 1 WHERE id = 1 AND main_conversation_id = 0" 2>/dev/null || true
  # 将 test 用户加入公共房间
  $MYSQL -e "
    INSERT IGNORE INTO room_members (room_id, user_id, role, join_at_ms) 
    VALUES (1, ${USER_ID}, 2, $(date +%s)000)" 2>/dev/null || true
fi

# 重新获取完整参数
ROOMS=$(/usr/bin/curl -s -b "$COOKIE" "$BASE/api/rooms")
ROOM_ID=$(echo "$ROOMS" | /usr/bin/jq -r '.rooms[0].id // "0"')
CONV_ID=$(echo "$ROOMS" | /usr/bin/jq -r '.rooms[0].main_conversation_id // "0"')
[ "$ROOM_ID" = "null" ] && ROOM_ID="0"
[ "$CONV_ID" = "null" ] && CONV_ID="0"
echo "room=$ROOM_ID  conv=$CONV_ID"
if [ "$ROOM_ID" = "0" ]; then
  echo "WARNING: 用户仍无房间，依赖房间/会话的 API 将走 404 路径"
fi

# 找一个非 Personal 类型的房间用于邀请种子
INV_ROOM_ID=$(echo "$ROOMS" | /usr/bin/jq -r '.rooms[] | select(.type != 1) | .id // "0"' | /usr/bin/head -1)
[ -z "$INV_ROOM_ID" ] || [ "$INV_ROOM_ID" = "null" ] && INV_ROOM_ID="$ROOM_ID"
echo "invitation room=$INV_ROOM_ID"

# 清理残留 bench 房间
$MYSQL -e "DELETE FROM conversations WHERE room_id IN (SELECT id FROM rooms WHERE name='bench-tmp')" 2>/dev/null || true
$MYSQL -e "DELETE FROM room_members WHERE room_id IN (SELECT id FROM rooms WHERE name='bench-tmp')" 2>/dev/null || true
$MYSQL -e "DELETE FROM rooms WHERE name='bench-tmp'" 2>/dev/null || true
echo "cleaned old bench rooms"

# 清理孤立 room_members（历史 benchmark 残留，users/participants 已删但 room_members 还在）
$MYSQL -e "DELETE rm FROM room_members rm LEFT JOIN users u ON rm.user_id = u.id WHERE u.id IS NULL AND rm.user_id > 1000" 2>/dev/null || true

# ═══════════════════════════════════════
# 2. 种子数据（可重复调用）
# ═══════════════════════════════════════
seed_data() {
  BENCH_FRIEND="bf_$(date +%s)"
BENCH_FRIEND_PASS="bf123"
FRIEND_ID="0"; FR_ID="0"; INV_ID="0"

echo ""
echo "=== Seed: registering $BENCH_FRIEND ==="
/usr/bin/curl -s -X POST -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=${BENCH_FRIEND}&password=${BENCH_FRIEND_PASS}" "$BASE/api/register" > /dev/null

FRIEND_TOKEN=$(/usr/bin/curl -s -i -X POST \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=${BENCH_FRIEND}&password=${BENCH_FRIEND_PASS}" \
  "$BASE/api/login" | /usr/bin/grep -oP 'session_id=\K[a-f0-9]+' | /usr/bin/head -1)
FRIEND_COOKIE="session_id=${FRIEND_TOKEN}"
FRIEND_ME=$(/usr/bin/curl -s -b "$FRIEND_COOKIE" "$BASE/api/me")
FRIEND_ID=$(echo "$FRIEND_ME" | /usr/bin/jq -r '.user_id // "0"')
echo "friend user_id=$FRIEND_ID"

if [ "$FRIEND_ID" != "0" ] && [ "$USER_ID" != "0" ]; then
  echo "=== Seed: friend request ==="
  FR_RESP=$(/usr/bin/curl -s -b "$FRIEND_COOKIE" -X POST \
    -H "Content-Type: application/json" \
    -d "{\"to_user_id\":${USER_ID}}" "$BASE/api/friend-requests")
  FR_ID=$(echo "$FR_RESP" | /usr/bin/jq -r '.request_id // "0"')
  echo "friend_request id=$FR_ID"

  if [ "$FR_ID" != "0" ]; then
    /usr/bin/curl -s -b "$COOKIE" -X PATCH \
      -H "Content-Type: application/json" \
      -d '{"status":"accepted"}' "$BASE/api/friend-requests/${FR_ID}" > /dev/null
    echo "friend request accepted → friendship created"
  fi

  # 创建 Normal 房间用于邀请种子（大厅已有 FRIEND_ID 拒绝，个人房间不允邀请）
  echo "=== Seed: creating invite room ==="
  INV_ROOM_RESP=$(/usr/bin/curl -s -b "$COOKIE" -X POST \
    -H "Content-Type: application/json" \
    -d '{"room_name":"bench-invite-room"}' "$BASE/api/rooms")
  INV_ROOM_ID=$(echo "$INV_ROOM_RESP" | /usr/bin/jq -r '.room_id // "0"')
  echo "invite room id=$INV_ROOM_ID"

  if [ "$INV_ROOM_ID" != "0" ]; then
    echo "=== Seed: room invitation ==="
    INV_RESP=$(/usr/bin/curl -s -b "$COOKIE" -X POST \
      -H "Content-Type: application/json" \
      -d "{\"invitee_id\":${FRIEND_ID}}" "$BASE/api/rooms/${INV_ROOM_ID}/invitations")
    INV_ID=$(echo "$INV_RESP" | /usr/bin/jq -r '.invitation_id // "0"')
    echo "invitation id=$INV_ID"
  fi

  if [ "$CONV_ID" != "0" ]; then
    echo "=== Seed: inserting 50 messages ==="
    for i in $(seq 1 50); do
      TS=$((1700000000000 + i * 1000))
      $MYSQL -e \
        "INSERT INTO messages (conversation_id, send_id, type, content, send_time_ms, client_message_id)
         VALUES (${CONV_ID}, ${USER_ID}, 0, 'bench msg ${i}', ${TS}, 'bench_${CONV_ID}_${i}')" 2>/dev/null
    done
    echo "messages inserted"
  fi
fi

if [ "$USER_ID" != "0" ]; then
  $MYSQL -e \
    "INSERT INTO ai_usage (user_id, date, count, daily_quota) VALUES (${USER_ID}, CURDATE(), 5, 20)
     ON DUPLICATE KEY UPDATE count = 5" 2>/dev/null || true
  fi
}
seed_data

# ── 清理函数（trap EXIT） ──
cleanup_seed_data() {
  echo ""
  echo "=== Cleanup bench data ==="
  # AI 成员（ai_id=99999）
  $MYSQL -e "DELETE FROM room_ai_members WHERE ai_id = 99999" 2>/dev/null || true
  $MYSQL -e "DELETE FROM conversation_ai_members WHERE ai_id = 99999" 2>/dev/null || true

  # bench-tmp 房间级联
  $MYSQL -e "DELETE FROM room_ai_members WHERE room_id IN (SELECT id FROM rooms WHERE name='bench-tmp')" 2>/dev/null || true
  $MYSQL -e "DELETE FROM invitations WHERE room_id IN (SELECT id FROM rooms WHERE name='bench-tmp')" 2>/dev/null || true
  $MYSQL -e "DELETE FROM room_members WHERE room_id IN (SELECT id FROM rooms WHERE name='bench-tmp')" 2>/dev/null || true
  $MYSQL -e "DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE room_id IN (SELECT id FROM rooms WHERE name='bench-tmp'))" 2>/dev/null || true
  $MYSQL -e "DELETE FROM conversation_ai_members WHERE conversation_id IN (SELECT id FROM conversations WHERE room_id IN (SELECT id FROM rooms WHERE name='bench-tmp'))" 2>/dev/null || true
  $MYSQL -e "DELETE FROM conversations WHERE room_id IN (SELECT id FROM rooms WHERE name='bench-tmp')" 2>/dev/null || true
  $MYSQL -e "DELETE FROM rooms WHERE name='bench-tmp'" 2>/dev/null || true

  # bench-tmp 对话
  $MYSQL -e "DELETE FROM conversation_ai_members WHERE conversation_id IN (SELECT id FROM conversations WHERE title='bench-tmp')" 2>/dev/null || true
  $MYSQL -e "DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE title='bench-tmp')" 2>/dev/null || true
  $MYSQL -e "DELETE FROM conversations WHERE title='bench-tmp'" 2>/dev/null || true

  # bench-invite-room 邀请种子房间级联
  $MYSQL -e "DELETE FROM invitations WHERE room_id IN (SELECT id FROM rooms WHERE name='bench-invite-room')" 2>/dev/null || true
  $MYSQL -e "DELETE FROM room_members WHERE room_id IN (SELECT id FROM rooms WHERE name='bench-invite-room')" 2>/dev/null || true
  $MYSQL -e "DELETE FROM conversations WHERE room_id IN (SELECT id FROM rooms WHERE name='bench-invite-room')" 2>/dev/null || true
  $MYSQL -e "DELETE FROM rooms WHERE name='bench-invite-room'" 2>/dev/null || true

  if [ "$FRIEND_ID" != "0" ]; then
    $MYSQL -e "DELETE FROM friendships WHERE user_a_id = ${FRIEND_ID} OR user_b_id = ${FRIEND_ID}" 2>/dev/null || true
    $MYSQL -e "DELETE FROM friend_requests WHERE from_user_id = ${FRIEND_ID} OR to_user_id = ${FRIEND_ID}" 2>/dev/null || true
    $MYSQL -e "DELETE FROM room_members WHERE user_id = ${FRIEND_ID}" 2>/dev/null || true
    $MYSQL -e "DELETE FROM invitations WHERE inviter_id = ${FRIEND_ID} OR invitee_id = ${FRIEND_ID}" 2>/dev/null || true
    $MYSQL -e "DELETE FROM ai_usage WHERE user_id = ${FRIEND_ID}" 2>/dev/null || true
    $MYSQL -e "DELETE FROM users WHERE id = ${FRIEND_ID}" 2>/dev/null || true
    $MYSQL -e "DELETE FROM participants WHERE id = ${FRIEND_ID}" 2>/dev/null || true
    echo "deleted friend user $FRIEND_ID"
  fi
  if [ "$CONV_ID" != "0" ]; then
    $MYSQL -e "DELETE FROM messages WHERE client_message_id LIKE 'bench_${CONV_ID}_%'" 2>/dev/null || true
    echo "deleted seed messages"
  fi
  echo "Cleanup done"
}

cleanup_seed() {
  # 恢复 perf_event_paranoid
  if [ -n "${PARANOID_OLD:-}" ] && [ "${PARANOID_OLD:-}" -gt 1 ]; then
    /usr/bin/sudo /sbin/sysctl -q kernel.perf_event_paranoid="$PARANOID_OLD" 2>/dev/null || true
  fi
  cleanup_seed_data
}
trap cleanup_seed EXIT

# ═══════════════════════════════════════
# 3. Warmup
# ═══════════════════════════════════════
warmup() {
  echo ""
  echo "=== Warmup (10s) ==="
  for i in 1 2 3 4 5; do
    /usr/bin/curl -s -b "$COOKIE" "$BASE/api/me" -o /dev/null &
    /usr/bin/curl -s -b "$COOKIE" "$BASE/api/rooms" -o /dev/null &
    /usr/bin/curl -s -b "$COOKIE" "$BASE/api/conversations/${CONV_ID}/messages?limit=10" -o /dev/null &
    wait
    done
  echo "Warmup done"
}
warmup

# ═══════════════════════════════════════
# 4. API 定义（用当前种子变量展开，可重复调用）
# ═══════════════════════════════════════
define_apis() {
  APIS=(
    "login|POST|/api/login||username=$TEST_USER&password=$TEST_PASS|form"
    "register|POST|/api/register||${REG_BODY}|form"
    "me|GET|/api/me||-|-"
    "me-update|PATCH|/api/me||{\"nickname\":\"$TEST_USER\"}|json"
    "me-ai-usage|GET|/api/me/ai-usage||-|-"
    "me-ai-usage-today|GET|/api/me/ai-usage/today||-|-"
    "search-users|GET|/api/users/search|?q=${BENCH_FRIEND}|-|-"
    "rooms-list|GET|/api/rooms||-|-"
    "rooms-create|POST|/api/rooms||{\"room_name\":\"bench-tmp\"}|json"
    "rooms-delete|DELETE|/api/rooms/99999||-|-"
    "rooms-update|PATCH|/api/rooms/${ROOM_ID}||{\"name\":\"test-room\"}|json"
    "room-convs|GET|/api/rooms/${ROOM_ID}/conversations||-|-"
    "room-convs-create|POST|/api/rooms/${ROOM_ID}/conversations||{\"title\":\"bench-tmp\"}|json"
    "room-members|GET|/api/rooms/${ROOM_ID}/members||-|-"
    "room-members-kick|DELETE|/api/rooms/${ROOM_ID}/members/99999||-|-"
    "room-members-role|PATCH|/api/rooms/${ROOM_ID}/members/${USER_ID}||{\"role\":2}|json"
    "room-invitations|GET|/api/rooms/${ROOM_ID}/invitations||-|-"
    "room-invitations-create|POST|/api/rooms/${INV_ROOM_ID}/invitations||{\"invitee_id\":${FRIEND_ID}}|json"
    "invitations-list|GET|/api/invitations|?direction=received|-|-"
    "invitations-respond|PATCH|/api/invitations/${INV_ID}||{\"status\":\"accepted\"}|json"
    "invitations-cancel|DELETE|/api/invitations/${INV_ID}||-|-"
    "conv-messages|GET|/api/conversations/${CONV_ID}/messages|?limit=50|-|-"
    "conv-model|GET|/api/conversations/${CONV_ID}/model||-|-"
    "conv-delete|DELETE|/api/conversations/99999||-|-"
    "conv-rename|PATCH|/api/conversations/${CONV_ID}/title||{\"title\":\"bench-test\"}|json"
    "msg-delete|DELETE|/api/messages/99999||-|-"
    "friend-requests-list|GET|/api/friend-requests|?direction=received|-|-"
    "friend-requests-create|POST|/api/friend-requests||{\"to_user_id\":${FRIEND_ID}}|json"
    "friend-requests-respond|PATCH|/api/friend-requests/${FR_ID}||{\"status\":\"accepted\"}|json"
    "friend-requests-cancel|DELETE|/api/friend-requests/${FR_ID}||-|-"
    "friends-list|GET|/api/friends||-|-"
    "friends-delete|DELETE|/api/friends/${FRIEND_ID}||-|-"
    "ais-list|GET|/api/ais||-|-"
    "thinking-adapters|GET|/api/thinking-adapters||-|-"
    "room-ai-list|GET|/api/rooms/${ROOM_ID}/ai-members||-|-"
    "room-ai-create|POST|/api/rooms/${ROOM_ID}/ai-members||{\"ai_id\":99999}|json"
    "room-ai-update|PATCH|/api/rooms/${ROOM_ID}/ai-members/99999||{\"adapter_url\":\"\"}|json"
    "room-ai-delete|DELETE|/api/rooms/${ROOM_ID}/ai-members/99999||-|-"
    "conv-ai-list|GET|/api/conversations/${CONV_ID}/ai-members||-|-"
    "conv-ai-create|POST|/api/conversations/${CONV_ID}/ai-members||{\"ai_id\":99999}|json"
    "conv-ai-update|PATCH|/api/conversations/${CONV_ID}/ai-members/99999||{\"adapter_url\":\"\"}|json"
    "conv-ai-delete|DELETE|/api/conversations/${CONV_ID}/ai-members/99999||-|-"
  )
}
define_apis

# ═══════════════════════════════════════
# 5. run_oha helper
# ═══════════════════════════════════════
run_oha() {
  local LOG="$1"
  case "$METHOD" in
    GET)
      "$OHA" -z 30s -c "$CONC" -H "Cookie: $COOKIE" "$URL" > "$LOG" 2>&1 || true ;;
    DELETE)
      "$OHA" -z 30s -c "$CONC" -m DELETE -H "Cookie: $COOKIE" "$URL" > "$LOG" 2>&1 || true ;;
    POST)
      if [ "$BODY" = "-" ]; then
        "$OHA" -z 30s -c "$CONC" -m POST -H "Cookie: $COOKIE" "$URL" > "$LOG" 2>&1 || true
      elif [ "$CT" = "form" ]; then
        "$OHA" -z 30s -c "$CONC" -m POST -H "Cookie: $COOKIE" -H "Content-Type: application/x-www-form-urlencoded" -d "$BODY" "$URL" > "$LOG" 2>&1 || true
      else
        "$OHA" -z 30s -c "$CONC" -m POST -H "Cookie: $COOKIE" -H "Content-Type: application/json" -d "$BODY" "$URL" > "$LOG" 2>&1 || true
      fi ;;
    PATCH)
      if [ "$BODY" = "-" ]; then
        "$OHA" -z 30s -c "$CONC" -m PATCH -H "Cookie: $COOKIE" "$URL" > "$LOG" 2>&1 || true
      else
        "$OHA" -z 30s -c "$CONC" -m PATCH -H "Cookie: $COOKIE" -H "Content-Type: application/json" -d "$BODY" "$URL" > "$LOG" 2>&1 || true
      fi ;;
  esac
}

parse_oha() {
  local LOG="$1"
  RPS=$(/usr/bin/grep -oP 'Requests/sec:\s*\K[\d.]+' "$LOG" 2>/dev/null)
  P50=$(/usr/bin/grep -oP '50\.00% in \K[\d.]+ ms' "$LOG" 2>/dev/null)
  P90=$(/usr/bin/grep -oP '90\.00% in \K[\d.]+ ms' "$LOG" 2>/dev/null)
  P99=$(/usr/bin/grep -oP '99\.00% in \K[\d.]+ ms' "$LOG" 2>/dev/null)
  SUCCESS=$(/usr/bin/grep -oP 'Success rate:\s*\K[\d.]+%' "$LOG" 2>/dev/null)
  TOTAL=$(/usr/bin/grep -oP 'Total:\s*\K[\d.]+ ms' "$LOG" 2>/dev/null)
}

# ═══════════════════════════════════════
# 5a. Clean oha pass（仅 --full 模式）
# ═══════════════════════════════════════
if [ "$MODE" = "full" ]; then
  write_html_header "API Benchmark Report" "$BENCH_HTML" \
    "Clean oha data (no perf overhead). Concurrency=$CONC." ""
  echo ""
  echo "=== Pass 1/2: Clean Benchmark (no perf) — ${#APIS[@]} APIs ==="
  echo ""

  for api in "${APIS[@]}"; do
    IFS='|' read -r NAME METHOD PATH QS BODY CT <<< "$api"
    URL="${BASE}${PATH}${QS}"
    BENCH_LOG="$BENCH_DIR/bench_${NAME}.log"

    echo "--- $METHOD $NAME: $URL ---"
    run_oha "$BENCH_LOG"
    parse_oha "$BENCH_LOG"
    [ -n "$RPS" ] && echo "  RPS=$RPS  p50=${P50}ms  p90=${P90}ms  p99=${P99}ms  $SUCCESS" || echo "  RPS=?"
    echo "<tr><td>$NAME</td><td>$METHOD</td><td>${PATH}${QS}</td><td>$RPS</td><td>${P50}ms</td><td>${P90}ms</td><td>${P99}ms</td><td>$SUCCESS</td><td>$TOTAL</td></tr>" >> "$BENCH_HTML"

    if [ "$NAME" = "register" ]; then
      $MYSQL -e "DELETE FROM users WHERE username='${REG_USER}'" 2>/dev/null && \
        echo "  cleanup: deleted $REG_USER" || echo "  cleanup: delete $REG_USER failed (may already be gone)"
    fi
    echo ""
  done

  echo "</table></body></html>" >> "$BENCH_HTML"

  # 重新播种，确保火焰图轮次状态干净
  cleanup_seed_data
  # 重新获取 params（ROOM_ID / CONV_ID 可能变了）
  ROOMS=$(/usr/bin/curl -s -b "$COOKIE" "$BASE/api/rooms")
  ROOM_ID=$(echo "$ROOMS" | /usr/bin/jq -r '.rooms[0].id // "0"')
  CONV_ID=$(echo "$ROOMS" | /usr/bin/jq -r '.rooms[0].main_conversation_id // "0"')
  [ "$ROOM_ID" = "null" ] && ROOM_ID="0"
  [ "$CONV_ID" = "null" ] && CONV_ID="0"
  # 重新 seed（FRIEND_ID, FR_ID, INV_ID, INV_ROOM_ID 会刷新）
  seed_data
  define_apis
  warmup
fi

# ═══════════════════════════════════════
# 5b. Flame 压测（perf + oha + flamegraph）
# ═══════════════════════════════════════
FLAME_EXTRA_COL="<th>Flame</th>"
FLAME_NOTE="Perf+oha data (with ~5-15% profiling overhead). Concurrency=$CONC."
write_html_header "API Flame Graph Report" "$FLAME_HTML" "$FLAME_NOTE" "$FLAME_EXTRA_COL"
echo ""
PASS_LABEL="Flamegraph"
[ "$MODE" = "full" ] && PASS_LABEL="2/2 Flamegraph"
echo "=== Pass ${PASS_LABEL}: ${#APIS[@]} APIs (concurrency=$CONC) ==="
echo ""

for api in "${APIS[@]}"; do
  IFS='|' read -r NAME METHOD PATH QS BODY CT <<< "$api"
  URL="${BASE}${PATH}${QS}"
  LOG="$LOG_DIR/oha_${NAME}.log"
  SVG="$SVG_DIR/flame_${NAME}.svg"

  echo "--- $METHOD $NAME: $URL ---"
  # 每次循环重新检测 PID，防止服务重启后绑定失效
  PID=$(/usr/bin/fuser 8080/tcp 2>/dev/null | /usr/bin/grep -o '[0-9]\+' | /usr/bin/head -1)
  [ -z "$PID" ] && echo "  ERROR: 服务端口 8080 无监听进程" && exit 1

  /usr/bin/sudo /usr/bin/perf record -F 99 -e cpu-clock -p "$PID" -g -o /tmp/perf_$$.data -- /usr/bin/sleep 34 \
    >"$LOG_DIR/perf_${NAME}.log" 2>&1 &
  /usr/bin/sleep 1

  run_oha "$LOG"
  wait

  if [ "$NAME" = "register" ]; then
    $MYSQL -e "DELETE FROM users WHERE username='${REG_USER}'" 2>/dev/null && \
      echo "  cleanup: deleted $REG_USER" || echo "  cleanup: delete $REG_USER failed (may already be gone)"
  fi

  if [ -f /tmp/perf_$$.data ] && [ -s /tmp/perf_$$.data ]; then
    /usr/bin/sudo /usr/bin/perf script -i /tmp/perf_$$.data 2>/dev/null \
      | "$FG/stackcollapse-perf.pl" 2>/dev/null > "$AGENT_DIR/stacks_${NAME}.txt" && \
      "$FG/flamegraph.pl" < "$AGENT_DIR/stacks_${NAME}.txt" > "$SVG" 2>/dev/null && \
      echo "  SVG: $(/usr/bin/wc -c < "$SVG") bytes" || echo "  WARN: flamegraph failed"
    /usr/bin/sudo /usr/bin/rm -f /tmp/perf_$$.data
  else
    echo "  SKIP: no perf data"
  fi

  parse_oha "$LOG"
  [ -n "$RPS" ] && echo "  RPS=$RPS  p50=${P50}ms  p90=${P90}ms  p99=${P99}ms  $SUCCESS" || echo "  RPS=?"
  echo "<tr><td>$NAME</td><td>$METHOD</td><td>${PATH}${QS}</td><td>$RPS</td><td>${P50}ms</td><td>${P90}ms</td><td>${P99}ms</td><td>$SUCCESS</td><td>$TOTAL</td><td><a href=\"svg/flame_${NAME}.svg\">SVG</a></td></tr>" >> "$FLAME_HTML"
  echo ""
done

echo "</table></body></html>" >> "$FLAME_HTML"

echo "=== DONE ==="
echo "火焰图: $SVG_DIR/"
/usr/bin/ls -lh "$SVG_DIR"/
echo "汇总页: $FLAME_HTML"
[ "$MODE" = "full" ] && echo "Benchmark: $BENCH_HTML"
