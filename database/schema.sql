CREATE DATABASE webserver;
USE webserver;

CREATE TABLE participants (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  kind TINYINT UNSIGNED NOT NULL COMMENT '1=USER, 2=AI, 3=SYSTEM',
  display_name VARCHAR(32) NOT NULL,
  avatar_url VARCHAR(255) DEFAULT NULL,
  created_at_ms BIGINT UNSIGNED DEFAULT NULL,

  PRIMARY KEY (id),
  KEY idx_kind (kind)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4
COMMENT = '统一消息发送者表；users/ai/system 都先在这里注册身份';


CREATE TABLE users (
  id BIGINT UNSIGNED NOT NULL COMMENT '应用层外键：users.id = participants.id，kind=1',
  username VARCHAR(32) UNIQUE NOT NULL,
  password_hash BINARY(32),
  salt BINARY(16),

  PRIMARY KEY (id)

  -- APP FK: users.id -> participants.id
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;


CREATE TABLE ai (
  id BIGINT UNSIGNED NOT NULL COMMENT '应用层外键：ai.id = participants.id，kind=2',
  provider VARCHAR(32) NOT NULL COMMENT '例如 deepseek / chatgpt',
  model VARCHAR(64) NOT NULL COMMENT '例如 deepseek-chat / deepseek-reasoner',
  system_prompt TEXT,

  PRIMARY KEY (id),
  KEY idx_model (model)

  -- APP FK: ai.id -> participants.id
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;


CREATE TABLE rooms (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(32) NOT NULL,
  main_conversation_id BIGINT UNSIGNED NOT NULL COMMENT '应用层外键：rooms.main_conversation_id -> conversations.id',
  owner_id BIGINT UNSIGNED NOT NULL COMMENT '应用层外键：owner_id -> users.id；0 表示系统创建',
  created_at_ms BIGINT UNSIGNED NOT NULL,
  type TINYINT UNSIGNED NOT NULL DEFAULT 2 COMMENT '0=大厅/系统房间, 1=个人房间, 2=普通房间',

  PRIMARY KEY (id)

  -- APP FK: rooms.main_conversation_id -> conversations.id
  -- APP FK: rooms.owner_id -> users.id
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;


INSERT INTO rooms (id, name, main_conversation_id, owner_id, created_at_ms, type)
VALUES (1, 'Atrium 大厅', 1, 0, 0, 0);


CREATE TABLE room_members (
  room_id BIGINT UNSIGNED NOT NULL COMMENT '应用层外键：room_members.room_id -> rooms.id',
  user_id BIGINT UNSIGNED NOT NULL COMMENT '应用层外键：room_members.user_id -> users.id',
  role TINYINT UNSIGNED NOT NULL COMMENT '例如 1=owner, 2=admin, 3=member',
  join_at_ms BIGINT UNSIGNED NOT NULL,

  PRIMARY KEY (room_id, user_id),
  KEY idx_user_join (user_id, join_at_ms, room_id)

  -- APP FK: room_members.room_id -> rooms.id
  -- APP FK: room_members.user_id -> users.id
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;


CREATE TABLE conversations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  room_id BIGINT UNSIGNED NOT NULL COMMENT '应用层外键：conversations.room_id -> rooms.id',
  title VARCHAR(32) NOT NULL,
  created_by BIGINT UNSIGNED NOT NULL COMMENT '应用层外键：created_by -> participants.id；0 表示系统创建',
  created_at_ms BIGINT UNSIGNED NOT NULL,

  PRIMARY KEY (id),
  KEY idx_room_id (room_id)

  -- APP FK: conversations.room_id -> rooms.id
  -- APP FK: conversations.created_by -> participants.id
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;


INSERT INTO conversations (id, room_id, title, created_by, created_at_ms)
VALUES (1, 1, 'Atrium 大厅', 0, 0);


CREATE TABLE conversation_ai_members (
  conversation_id BIGINT UNSIGNED NOT NULL COMMENT '应用层外键：conversation_ai_members.conversation_id -> conversations.id',
  ai_id BIGINT UNSIGNED NOT NULL COMMENT '应用层外键：conversation_ai_members.ai_id -> ai.id',
  adapter_url VARCHAR(255) DEFAULT NULL COMMENT '系统预设思维 adapter 文件路径',
  custom_adapter_text TEXT DEFAULT NULL COMMENT '用户自定义思维描述',

  PRIMARY KEY (conversation_id, ai_id),
  KEY idx_ai (ai_id)

  -- APP FK: conversation_ai_members.conversation_id -> conversations.id
  -- APP FK: conversation_ai_members.ai_id -> ai.id
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE room_ai_members (
  room_id BIGINT UNSIGNED NOT NULL COMMENT '应用层外键：room_ai_members.room_id -> rooms.id',
  ai_id BIGINT UNSIGNED NOT NULL COMMENT '应用层外键：room_ai_members.ai_id -> ai.id',
  adapter_url VARCHAR(255) DEFAULT NULL COMMENT '系统预设思维 adapter 文件路径',
  custom_adapter_text TEXT DEFAULT NULL COMMENT '用户自定义思维描述',

  PRIMARY KEY (room_id, ai_id),
  KEY idx_ai (ai_id)

  -- APP FK: room_ai_members.room_id -> rooms.id
  -- APP FK: room_ai_members.ai_id -> ai.id
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;


CREATE TABLE messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  conversation_id BIGINT UNSIGNED NOT NULL COMMENT '应用层外键：messages.conversation_id -> conversations.id',
  send_id BIGINT UNSIGNED NOT NULL COMMENT '应用层外键：messages.send_id -> participants.id，不再直接指向 users.id',
  type TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '1=TEXT, 2=IMAGE, 3=FILE, 4=SYSTEM',
  content VARCHAR(4000) NOT NULL,
  send_time_ms BIGINT UNSIGNED NOT NULL,
  client_message_id VARCHAR(64) DEFAULT NULL,
  deleted_at_ms BIGINT UNSIGNED DEFAULT NULL,

  PRIMARY KEY (id),
  KEY idx_conv_time_id (conversation_id, send_time_ms, id),
  KEY idx_send_id (send_id)

  -- APP FK: messages.conversation_id -> conversations.id
  -- APP FK: messages.send_id -> participants.id
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;


CREATE TABLE friendships (
  user_a_id BIGINT UNSIGNED NOT NULL COMMENT '应用层外键：friendships.user_a_id -> users.id',
  user_b_id BIGINT UNSIGNED NOT NULL COMMENT '应用层外键：friendships.user_b_id -> users.id',
  created_at_ms BIGINT UNSIGNED NOT NULL,

  PRIMARY KEY (user_a_id, user_b_id),
  KEY idx_user_b_id (user_b_id),
  CONSTRAINT chk_friendship_order CHECK (user_a_id < user_b_id)

  -- APP FK: friendships.user_a_id -> users.id
  -- APP FK: friendships.user_b_id -> users.id
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;


CREATE TABLE invitations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  room_id BIGINT UNSIGNED NOT NULL COMMENT '应用层外键：invitations.room_id -> rooms.id',
  inviter_id BIGINT UNSIGNED NOT NULL COMMENT '应用层外键：invitations.inviter_id -> users.id',
  invitee_id BIGINT UNSIGNED NOT NULL COMMENT '应用层外键：invitations.invitee_id -> users.id',
  created_at_ms BIGINT UNSIGNED NOT NULL,

  PRIMARY KEY (id),
  UNIQUE KEY uk_room_invitee (room_id, invitee_id),
  KEY idx_invitee (invitee_id)

  -- APP FK: invitations.room_id -> rooms.id
  -- APP FK: invitations.inviter_id -> users.id
  -- APP FK: invitations.invitee_id -> users.id
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;


CREATE TABLE friend_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  from_user_id BIGINT UNSIGNED NOT NULL COMMENT '应用层外键：friend_requests.from_user_id -> users.id',
  to_user_id BIGINT UNSIGNED NOT NULL COMMENT '应用层外键：friend_requests.to_user_id -> users.id',
  created_at_ms BIGINT UNSIGNED NOT NULL,

  PRIMARY KEY (id),
  UNIQUE KEY uk_from_to (from_user_id, to_user_id),
  KEY idx_to_user (to_user_id)

  -- APP FK: friend_requests.from_user_id -> users.id
  -- APP FK: friend_requests.to_user_id -> users.id
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;


CREATE TABLE ai_usage (
  user_id BIGINT UNSIGNED NOT NULL COMMENT '应用层外键：ai_usage.user_id -> users.id',
  date DATE NOT NULL,
  count TINYINT UNSIGNED NOT NULL DEFAULT 0,
  daily_quota TINYINT UNSIGNED NOT NULL DEFAULT 20,

  PRIMARY KEY (user_id, date)

  -- APP FK: ai_usage.user_id -> users.id
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4
COMMENT = '用户每日 AI 调用次数 + 每日配额';

CREATE TABLE user_ai_tokens (
  user_id BIGINT UNSIGNED NOT NULL COMMENT '应用层外键：user_ai_tokens.user_id -> users.id',
  date DATE NOT NULL,
  model_id SMALLINT UNSIGNED NOT NULL COMMENT '应用层外键：ai_models.id',

  input_cached_tokens BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '输入token：命中缓存',
  input_uncached_tokens BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '输入token：未命中缓存',
  output_tokens BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '输出token',

  total_tokens BIGINT UNSIGNED
    GENERATED ALWAYS AS (
      input_cached_tokens + input_uncached_tokens + output_tokens
    ) STORED,

  request_count INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '当天该模型请求次数',

  PRIMARY KEY (user_id, date, model_id),
  KEY idx_model_date (model_id, date)

  -- APP FK:
  -- user_ai_tokens.user_id -> users.id
  -- user_ai_tokens.model_id -> ai_models.id
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4
COMMENT = '用户每日各模型 AI token 消耗统计';
