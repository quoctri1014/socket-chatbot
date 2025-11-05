USE chatbot_db;

DROP TABLE IF EXISTS users;
CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(100) NOT NULL UNIQUE,
  passwordHash VARCHAR(255) NOT NULL,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


-- 1. Bảng tin nhắn 1-1
DROP TABLE IF EXISTS messages; 
CREATE TABLE messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  senderId INT NOT NULL,
  recipientId INT NOT NULL,
  content TEXT NOT NULL,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (senderId) REFERENCES users(id),
  FOREIGN KEY (recipientId) REFERENCES users(id)
);

-- 2. Bảng lưu thông tin nhóm
DROP TABLE IF EXISTS groups;
CREATE TABLE groups (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  creatorId INT NOT NULL,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (creatorId) REFERENCES users(id)
);

-- 3. Bảng liên kết User và Nhóm (Ai ở trong nhóm nào)
DROP TABLE IF EXISTS group_members;
CREATE TABLE group_members (
  id INT AUTO_INCREMENT PRIMARY KEY,
  groupId INT NOT NULL,
  userId INT NOT NULL,
  joinedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (groupId) REFERENCES groups(id) ON DELETE CASCADE,
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY (groupId, userId)
);

-- 4. Bảng tin nhắn nhóm
DROP TABLE IF EXISTS group_messages;
CREATE TABLE group_messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  groupId INT NOT NULL,
  senderId INT NOT NULL,
  content TEXT NOT NULL,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (groupId) REFERENCES groups(id) ON DELETE CASCADE,
  FOREIGN KEY (senderId) REFERENCES users(id)
);
