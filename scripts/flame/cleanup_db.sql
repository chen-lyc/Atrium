-- 全面清理压测产生的所有脏数据
-- 用法: sudo mysql webserver < scripts/flame/cleanup_db.sql

-- Step 1: 清 room_ai_members（子表）
DELETE FROM room_ai_members WHERE ai_id = 99999;
DELETE FROM room_ai_members WHERE room_id IN (SELECT id FROM (SELECT id FROM rooms WHERE name LIKE 'bench%' OR name LIKE 'bf_%') AS t);

-- Step 2: 清 conversation_ai_members（子表）
DELETE FROM conversation_ai_members WHERE ai_id = 99999;
DELETE FROM conversation_ai_members WHERE conversation_id IN (
  SELECT id FROM (SELECT id FROM conversations WHERE title LIKE 'bench%' OR title LIKE 'bf_%') AS t
);
DELETE FROM conversation_ai_members WHERE conversation_id IN (
  SELECT id FROM (SELECT c.id FROM conversations c JOIN rooms r ON c.room_id = r.id WHERE r.name LIKE 'bench%' OR r.name LIKE 'bf_%') AS t
);

-- Step 3: 清 messages（子表）
DELETE FROM messages WHERE client_message_id LIKE 'bench_%';
DELETE FROM messages WHERE conversation_id IN (
  SELECT id FROM (SELECT id FROM conversations WHERE title LIKE 'bench%' OR title LIKE 'bf_%') AS t
);
DELETE FROM messages WHERE conversation_id IN (
  SELECT id FROM (SELECT c.id FROM conversations c JOIN rooms r ON c.room_id = r.id WHERE r.name LIKE 'bench%' OR r.name LIKE 'bf_%') AS t
);

-- Step 4: 清 invitations（子表）
DELETE FROM invitations WHERE room_id IN (SELECT id FROM (SELECT id FROM rooms WHERE name LIKE 'bench%' OR name LIKE 'bf_%') AS t);
DELETE FROM invitations WHERE inviter_id IN (SELECT id FROM (SELECT id FROM users WHERE username LIKE 'bf_%' OR username LIKE 'bench_%') AS t);
DELETE FROM invitations WHERE invitee_id IN (SELECT id FROM (SELECT id FROM users WHERE username LIKE 'bf_%' OR username LIKE 'bench_%') AS t);

-- Step 5: 清 room_members（子表）
DELETE FROM room_members WHERE room_id IN (SELECT id FROM (SELECT id FROM rooms WHERE name LIKE 'bench%' OR name LIKE 'bf_%') AS t);
DELETE FROM room_members WHERE user_id IN (SELECT id FROM (SELECT id FROM users WHERE username LIKE 'bf_%' OR username LIKE 'bench_%') AS t);
-- 清理孤立 room_members（user 已删但 room_members 残留）
DELETE rm FROM room_members rm LEFT JOIN users u ON rm.user_id = u.id WHERE u.id IS NULL;

-- Step 6: 清 friendships（引用压测用户 OR 孤立引用）
DELETE FROM friendships WHERE user_a_id IN (SELECT id FROM (SELECT id FROM users WHERE username LIKE 'bf_%' OR username LIKE 'bench_%') AS t);
DELETE FROM friendships WHERE user_b_id IN (SELECT id FROM (SELECT id FROM users WHERE username LIKE 'bf_%' OR username LIKE 'bench_%') AS t);
DELETE f FROM friendships f LEFT JOIN users u ON f.user_a_id = u.id WHERE u.id IS NULL;
DELETE f FROM friendships f LEFT JOIN users u ON f.user_b_id = u.id WHERE u.id IS NULL;

-- Step 7: 清 friend_requests
DELETE FROM friend_requests WHERE from_user_id IN (SELECT id FROM (SELECT id FROM users WHERE username LIKE 'bf_%' OR username LIKE 'bench_%') AS t);
DELETE FROM friend_requests WHERE to_user_id IN (SELECT id FROM (SELECT id FROM users WHERE username LIKE 'bf_%' OR username LIKE 'bench_%') AS t);
DELETE fr FROM friend_requests fr LEFT JOIN users u ON fr.from_user_id = u.id WHERE u.id IS NULL;
DELETE fr FROM friend_requests fr LEFT JOIN users u ON fr.to_user_id = u.id WHERE u.id IS NULL;

-- Step 8: 清 ai_usage
DELETE FROM ai_usage WHERE user_id IN (SELECT id FROM (SELECT id FROM users WHERE username LIKE 'bf_%' OR username LIKE 'bench_%') AS t);

-- Step 9: 清 user_ai_tokens
DELETE FROM user_ai_tokens WHERE user_id IN (SELECT id FROM (SELECT id FROM users WHERE username LIKE 'bf_%' OR username LIKE 'bench_%') AS t);

-- Step 10: 清 conversations
DELETE FROM conversations WHERE title LIKE 'bench%' OR title LIKE 'bf_%';
DELETE c FROM conversations c LEFT JOIN rooms r ON c.room_id = r.id WHERE r.id IS NULL;

-- Step 11: 清 rooms
DELETE FROM rooms WHERE name LIKE 'bench%' OR name LIKE 'bf_%';

-- Step 12: 清 users（仅压测相关用户名）
DELETE FROM users WHERE username LIKE 'bf_%' OR username LIKE 'bench_%';

-- Step 13: 清 participants（不再关联 users 或 ai 的孤儿）
DELETE FROM participants WHERE id NOT IN (SELECT id FROM (SELECT u.id FROM users u) AS t)
  AND id NOT IN (SELECT id FROM (SELECT a.id FROM ai a) AS t);

-- Step 14: 清 ai（测试 AI + 孤儿）
DELETE FROM ai WHERE id = 99999;
DELETE FROM ai WHERE id NOT IN (SELECT id FROM (SELECT id FROM participants) AS t);

-- Step 15: 第二轮孤儿清理（父表删完后残留的子表数据）
DELETE rm FROM room_members rm LEFT JOIN rooms r ON rm.room_id = r.id WHERE r.id IS NULL;
DELETE rm FROM room_members rm LEFT JOIN users u ON rm.user_id = u.id WHERE u.id IS NULL;
DELETE m FROM messages m LEFT JOIN conversations c ON m.conversation_id = c.id WHERE c.id IS NULL;
DELETE cam FROM conversation_ai_members cam LEFT JOIN conversations c ON cam.conversation_id = c.id WHERE c.id IS NULL;
DELETE ram FROM room_ai_members ram LEFT JOIN rooms r ON ram.room_id = r.id WHERE r.id IS NULL;
DELETE inv FROM invitations inv LEFT JOIN rooms r ON inv.room_id = r.id WHERE r.id IS NULL;

-- 验证
SELECT '=== Cleanup Summary ===' AS '';
SELECT 'rooms' AS tbl, COUNT(*) AS cnt FROM rooms
UNION ALL SELECT 'conversations', COUNT(*) FROM conversations
UNION ALL SELECT 'room_members', COUNT(*) FROM room_members
UNION ALL SELECT 'messages', COUNT(*) FROM messages
UNION ALL SELECT 'users', COUNT(*) FROM users
UNION ALL SELECT 'participants', COUNT(*) FROM participants
UNION ALL SELECT 'invitations', COUNT(*) FROM invitations
UNION ALL SELECT 'friend_requests', COUNT(*) FROM friend_requests
UNION ALL SELECT 'friendships', COUNT(*) FROM friendships
UNION ALL SELECT 'ai_usage', COUNT(*) FROM ai_usage
UNION ALL SELECT 'room_ai_members', COUNT(*) FROM room_ai_members
UNION ALL SELECT 'conversation_ai_members', COUNT(*) FROM conversation_ai_members;
