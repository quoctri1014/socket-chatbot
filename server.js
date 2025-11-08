import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db from './db.js';
import axios from 'axios';
import OpenAI from 'openai';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENWEATHER_API_KEY = process.env.OPENWEATHER_API_KEY;
const GEOAPIFY_API_KEY = process.env.GEOAPIFY_API_KEY;
console.log("🔑 Đang kiểm tra Key thời tiết:", OPENWEATHER_API_KEY);
console.log("🔑 Đang kiểm tra Key địa điểm:", GEOAPIFY_API_KEY);

if (!OPENAI_API_KEY) {
  console.error('ERROR: Missing OPENAI_API_KEY in .env');
  process.exit(1);
}

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

const JWT_SECRET = 'day_la_khoa_bi_mat_cua_ban';

const app = express();
const server = http.createServer(app);
const io = new Server(server, { /* options */ });

// in-memory online users map: { userId: { socketId, username } }
const onlineUsers = {};
// -----------------------------------------------------------------
// --- (BẮT ĐẦU) THÊM TOÀN BỘ KHỐI CODE NÀY CHO AI THÔNG MINH ---
// -----------------------------------------------------------------

// --- A. Định nghĩa "Công cụ" cho AI biết ---
const tools = [
  {
    type: "function",
    function: {
      name: "get_weather_data",
      description: "Lấy thông tin thời tiết hiện tại cho một địa điểm cụ thể.",
      parameters: {
        type: "object",
        properties: {
          location: { 
            type: "string", 
            description: "Địa điểm cần tra cứu, ví dụ: Hà Nội, London" 
          }
        },
        required: ["location"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_tourist_attractions",
      description: "Lấy danh sách các địa điểm du lịch nổi tiếng tại một địa điểm.",
      parameters: {
        type: "object",
        properties: {
          location: { 
            type: "string", 
            description: "Địa điểm cần tìm, ví dụ: Paris, Đà Nẵng" 
          }
        },
        required: ["location"]
      }
    }
  }
];

// --- B. Hàm hỗ trợ gọi API Thời tiết (OpenWeatherMap) ---
async function getWeatherData(location) {
  if (!OPENWEATHER_API_KEY) {
    return JSON.stringify({ error: "Server chưa cấu hình API key cho thời tiết." });
  }
  try {
    const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(location)}&appid=${OPENWEATHER_API_KEY}&units=metric&lang=vi`;
    const response = await axios.get(url);
    
    // Chỉ trích xuất dữ liệu quan trọng
    const data = {
      location: response.data.name,
      temp: response.data.main.temp,
      feels_like: response.data.main.feels_like,
      description: response.data.weather[0].description,
      humidity: response.data.main.humidity
    };
    return JSON.stringify(data); // Trả về dạng JSON string cho AI
  } catch (error) {
    console.error("Lỗi OpenWeatherMap:", error.message);
    return JSON.stringify({ error: "Không tìm thấy địa điểm hoặc lỗi API thời tiết." });
  }
}

// --- C. Hàm hỗ trợ gọi API Địa điểm (Geoapify) ---
async function getTouristAttractions(location) {
  if (!GEOAPIFY_API_KEY) {
    return JSON.stringify({ error: "Server chưa cấu hình API key cho Geoapify." });
  }
  
  try {
    // Bước 1: Geocoding (Chuyển "Hà Nội" -> tọa độ lat, lon)
    const geocodeUrl = `https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(location)}&limit=1&apiKey=${GEOAPIFY_API_KEY}`;
    
    const geocodeRes = await axios.get(geocodeUrl);
    if (!geocodeRes.data.features || geocodeRes.data.features.length === 0) {
      throw new Error('Không tìm thấy tọa độ cho địa điểm.');
    }
    
    const { lon, lat } = geocodeRes.data.features[0].properties;

    // Bước 2: Tìm địa điểm du lịch (categories=tourism.attraction) gần tọa độ đó
    const radius = 10000; // Bán kính 10km
    const categories = 'tourism.attraction'; // Chỉ lấy địa điểm du lịch
    
    const placesUrl = `https://api.geoapify.com/v2/places?categories=${categories}&filter=circle:${lon},${lat},${radius}&limit=5&apiKey=${GEOAPIFY_API_KEY}`;
    
    const placesRes = await axios.get(placesUrl);
    if (!placesRes.data.features || placesRes.data.features.length === 0) {
      throw new Error('Không tìm thấy địa điểm du lịch nào gần đây.');
    }

    // Format 5 kết quả hàng đầu
    const topPlaces = placesRes.data.features.map(place => ({
      name: place.properties.name,
      address: place.properties.address_line2 || 'Không rõ địa chỉ'
    }));
    
    return JSON.stringify(topPlaces); // Trả về dạng JSON string cho AI

  } catch (error) {
    console.error("Lỗi Geoapify API:", error.message);
    return JSON.stringify({ error: "Lỗi khi tìm địa điểm du lịch." });
  }
}

// ---------------------------------------------------------------
// --- (KẾT THÚC) KHỐI CODE THÊM MỚI ---
// ---------------------------------------------------------------
async function handleAIChat(userMessage, myUserId, myUsername) {
  const socket = onlineUsers[myUserId] ? io.sockets.sockets.get(onlineUsers[myUserId].socketId) : null;
  if (!socket) return; // Thoát nếu user không online

  // (SỬA LỖI) Bước 0: Lưu tin nhắn của người dùng vào DB NGAY LẬP TỨC
  // Điều này đảm bảo cuộc hội thoại được ghi lại đầy đủ.
  try {
    await db.query(
      'INSERT INTO messages (senderId, recipientId, content) VALUES (?, ?, ?)',
      [myUserId, 0, userMessage] // senderId = user, recipientId = 0 (AI)
    );
  } catch (dbError) {
    console.error("Lỗi khi lưu tin nhắn của người dùng vào DB:", dbError);
    // Có thể thông báo lỗi cho người dùng nếu cần
    socket.emit('error', 'Không thể gửi tin nhắn của bạn lúc này.');
    return; // Dừng thực thi nếu không lưu được
  }

  // 1. Xây dựng mảng tin nhắn (với System Prompt mới)
  const messages = [
    { 
      role: 'system', 
      content: `Bạn là một Trợ lý AI hữu ích trong ứng dụng chat. Tên của bạn là 'Trợ lý ảo'.
      Bạn đang nói chuyện với người dùng tên là '${myUsername}'.
      Bạn có các công cụ để tra cứu thời tiết và địa điểm du lịch.
      Khi người dùng hỏi, hãy sử dụng các công cụ này để lấy dữ liệu.
      Sau đó, hãy TỔNG HỢP dữ liệu (thời tiết, địa điểm) để đưa ra lời khuyên về
      địa điểm và thời gian đi chơi hợp lý.
      Ví dụ: Nếu trời mưa, gợi ý bảo tàng. Nếu trời nắng, gợi ý công viên.
      Luôn trả lời bằng tiếng Việt.`
    }
  ];

  // 2. Lấy lịch sử chat (Bộ nhớ) - Lấy 10 tin nhắn cuối
  try {
    const [history] = await db.query(
      `SELECT content, senderId FROM messages 
       WHERE ((senderId = ? AND recipientId = 0) OR (senderId = 0 AND recipientId = ?))
       ORDER BY createdAt DESC LIMIT 9`, // SỬA LỖI: Chỉ lấy 9 tin nhắn cũ nhất
      [myUserId, myUserId]
    );
    // Thêm lịch sử vào mảng (theo thứ tự từ cũ đến mới)
    for (const msg of history.reverse()) {
      messages.push({
        role: msg.senderId === myUserId ? 'user' : 'assistant',
        content: msg.content
      });
    }
  } catch (err) {
    console.error("Lỗi khi lấy lịch sử chat:", err);
  }

  // 3. Thêm tin nhắn mới của người dùng
  messages.push({ role: 'user', content: userMessage });

  try {
    // 4. GỌI OPENAI LẦN 1 (Kiểm tra xem AI có cần dùng Tool không)
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini', // Bạn có thể dùng 'gpt-3.5-turbo' nếu muốn
      messages: messages,
      tools: tools, // <-- Báo cho AI biết chúng ta có các công cụ
      tool_choice: 'auto'
    });

    const responseMessage = response.choices[0].message;

    // 5. XỬ LÝ PHẢN HỒI CỦA AI
    const toolCalls = responseMessage.tool_calls;

    if (toolCalls) {
      // 5A. NẾU AI MUỐN DÙNG TOOL
      // Thêm phản hồi của AI (yêu cầu dùng tool) vào lịch sử
      messages.push(responseMessage);

      // Chạy từng tool mà AI yêu cầu
      for (const toolCall of toolCalls) {
        const functionName = toolCall.function.name;
        const functionArgs = JSON.parse(toolCall.function.arguments);
        let functionResponse;

        // Gọi hàm helper tương ứng
        if (functionName === 'get_weather_data') {
          functionResponse = await getWeatherData(functionArgs.location);
        } else if (functionName === 'get_tourist_attractions') {
          functionResponse = await getTouristAttractions(functionArgs.location);
        }

        // Thêm kết quả của tool vào lịch sử
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: functionResponse, // Kết quả dạng JSON string
        });
      }

      // 6. GỌI OPENAI LẦN 2 (Sau khi đã có dữ liệu)
      // Gửi toàn bộ lịch sử (bao gồm kết quả tool) để AI tổng hợp
      const finalResponse = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: messages,
      });
      
      const finalAnswer = finalResponse.choices[0].message.content;
      
      // Gửi câu trả lời cuối cùng cho người dùng và lưu vào DB
      const [result] = await db.query(
        'INSERT INTO messages (senderId, recipientId, content) VALUES (?, ?, ?)',
        [0, myUserId, finalAnswer]
      );
      socket.emit('newMessage', {
        id: result.insertId,
        senderId: 0,
        content: finalAnswer,
        createdAt: new Date()
      });

    } else {
      // 5B. NẾU AI TRẢ LỜI NGAY (Không cần tool, ví dụ: "Chào bạn")
      const aiReply = response.choices[0].message.content;
      
      // Gửi câu trả lời và lưu vào DB
      const [result] = await db.query(
        'INSERT INTO messages (senderId, recipientId, content) VALUES (?, ?, ?)',
        [0, myUserId, aiReply]
      );
      socket.emit('newMessage', {
        id: result.insertId,
        senderId: 0,
        content: aiReply,
        createdAt: new Date()
      });
    }
    
  } catch (error) {
    console.error("Lỗi khi gọi OpenAI (handleAIChat):", error);
    socket.emit('error', 'Trợ lý AI đang gặp lỗi, vui lòng thử lại sau.');
  }
}
app.use(express.static('public'));
app.use(express.json());

// --- auth middleware for REST APIs (unchanged) ---
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (token == null) return res.sendStatus(401);
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

// --- REST endpoints (register/login, groups) ---
// (Giữ nguyên toàn bộ code API của bạn)
app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ message: 'Vui long nhap ten va mat khau.' });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    await db.query('INSERT INTO users (username, passwordHash) VALUES (?, ?)', [username, passwordHash]);
    res.status(201).json({ message: 'Dang ky thanh cong!' });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ message: 'Ten dang nhap da ton tai.' });
    }
    console.error(error);
    res.status(500).json({ message: 'Loi may chu.' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const [rows] = await db.query('SELECT * FROM users WHERE username = ?', [username]);
    const user = rows[0];
    if (!user) return res.status(400).json({ message: 'Ten hoac mat khau sai.' });
    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) return res.status(400).json({ message: 'Ten hoac mat khau sai.' });
    const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '1h' });
    res.json({ message: 'Dang nhap thanh cong!', token });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Loi may chu.' });
  }
});

app.post('/api/groups/create', authenticateToken, async (req, res) => {
  const { name, members } = req.body;
  const creatorId = req.user.userId;
  if (!name || !members || members.length === 0) {
    return res.status(400).json({ message: 'Ten nhom va thanh vien la bat buoc.' });
  }
  if (!members.includes(creatorId)) members.push(creatorId);
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [groupResult] = await connection.query('INSERT INTO groups (name, creatorId) VALUES (?, ?)', [name, creatorId]);
    const groupId = groupResult.insertId;
    const memberValues = members.map(userId => [groupId, userId]);
    await connection.query('INSERT INTO group_members (groupId, userId) VALUES ?', [memberValues]);
    const [newGroupData] = await connection.query('SELECT id, name, creatorId FROM groups WHERE id = ?', [groupId]);
    await connection.commit();
    const newGroup = newGroupData[0];
    members.forEach(userId => {
      const userInfo = onlineUsers[userId];
      if (userInfo) {
        io.to(userInfo.socketId).emit('newGroupAdded', newGroup);
        const memberSocket = io.sockets.sockets.get(userInfo.socketId);
        // THAY ĐỔI NHỎ: Đảm bảo join đúng tên phòng
        if (memberSocket) memberSocket.join(`group_${groupId.toString()}`); 
      }
    });
    res.status(201).json({ message: 'Tao nhom thanh cong!', group: newGroup });
  } catch (error) {
    await connection.rollback();
    console.error('Loi tao nhom:', error);
    res.status(500).json({ message: 'Loi may chu khi tao nhom.' });
  } finally {
    connection.release();
  }
});

// --- Socket.IO auth middleware ---
io.use((socket, next) => {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  if (!token) return next(new Error('Xac thuc that bai: Khong co token'));
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return next(new Error('Xac thuc that bai: Token khong hop le'));
    socket.user = user;
    next();
  });
});

// ----- main socket logic -----
io.on('connection', async (socket) => {
  const myUserId = socket.user.userId;
  const myUsername = socket.user.username;
  console.log(`User ${myUsername} (ID: ${myUserId}) connected. socket=${socket.id}`);

  onlineUsers[myUserId] = { socketId: socket.id, username: myUsername };

  // auto join group rooms from DB (Giữ nguyên)
  try {
    const [memberOfGroups] = await db.query('SELECT groupId FROM group_members WHERE userId = ?', [myUserId]);
    memberOfGroups.forEach(g => socket.join(`group_${g.groupId.toString()}`));
  } catch (err) {
    console.error('join group error', err);
  }

  // welcome (Giữ nguyên)
  socket.emit('welcome', { userId: myUserId, username: myUsername });

  // Gửi danh sách người dùng đã cập nhật cho mọi người khi có người mới vào
  await broadcastUpdatedUserList();

  // ===================================
  // === BẮT ĐẦU THAY ĐỔI (DI CHUYỂN) ===
  // ===================================
  // Lấy danh sách nhóm của user (ĐÃ DI CHUYỂN RA VỊ TRÍ ĐÚNG)
  try {
    const [myGroups] = await db.query(
      'SELECT g.id, g.name FROM groups g JOIN group_members gm ON g.id = gm.groupId WHERE gm.userId = ?',
      [myUserId]
    );
    socket.emit('groupList', myGroups);
  } catch (err) {
    console.error(`Lỗi khi tải danh sách nhóm cho user ${myUserId}:`, err);
  }
  // =================================
  // === KẾT THÚC THAY ĐỔI ===
  // =================================

  // loadPrivateHistory (ĐÃ XÓA PHẦN TẢI GROUP LIST RA KHỎI ĐÂY)
  socket.on('loadPrivateHistory', async ({ recipientId }) => {
    if (recipientId === 0) {
      socket.emit('privateHistory', {
        recipientId: 0,
        messages: [{
          senderId: 0,
          content: 'Xin chào! Tôi là trợ lý AI. Bạn muốn hỏi tôi điều gì?',
          createdAt: new Date()
        }]
      });
      return;
    }

    try {
      // Lấy lịch sử tin nhắn riêng tư
      const [messages] = await db.query(
        `SELECT senderId, content, createdAt
         FROM messages
         WHERE (senderId = ? AND recipientId = ?) OR (senderId = ? AND recipientId = ?)
         ORDER BY createdAt ASC`,
        [myUserId, recipientId, recipientId, myUserId]
      );
      socket.emit('privateHistory', { recipientId, messages });

      // (ĐÃ XÓA KHỐI 'groupList' BỊ SAI VỊ TRÍ Ở ĐÂY)

    } catch (err) {
      console.error(`Lỗi khi tải dữ liệu cho user ${myUserId}:`, err);
    }
  });

  // (MỚI) Xử lý sự kiện chat với AI chuyên biệt
  socket.on('chatWithAI', async ({ content }) => {
    // Tái sử dụng hàm handleAIChat đã có
    // Điều này giúp client có một sự kiện rõ ràng hơn khi muốn nói chuyện với AI
    if (content) {
      await handleAIChat(content, myUserId, myUsername);
    }
  });


  // privateMessage (Giữ nguyên tính năng AI và chat 1-1 của bạn)
  socket.on('privateMessage', async (data) => {
    const { recipientId, content } = data;

    // --- Nếu nhắn giữa người dùng với nhau (Giữ nguyên) ---
    // (ĐÃ XÓA) Logic xử lý AI đã được chuyển hoàn toàn sang sự kiện 'chatWithAI'
    const senderId = myUserId;
    try {
      const [result] = await db.query(
        'INSERT INTO messages (senderId, recipientId, content) VALUES (?, ?, ?)',
        [senderId, recipientId, content]
      );
      const insertedId = result.insertId;
      const [newMsgRow] = await db.query('SELECT * FROM messages WHERE id = ?', [insertedId]);
      const newMsg = newMsgRow[0];
      const recipientInfo = onlineUsers[recipientId];

      if (recipientInfo) {
        io.to(recipientInfo.socketId).emit('newMessage', {
          senderId,
          content: newMsg.content,
          createdAt: newMsg.createdAt
        });
      }
    } catch (err) {
      console.error('privateMessage error:', err);
    }
  });

  // groupMessage (Giữ nguyên)
  socket.on('groupMessage', async ({ groupId, content }) => {
    if (!groupId || !content) {
      return; // Dữ liệu không hợp lệ
    }
    const senderId = myUserId; 
    const senderUsername = myUsername; 
    try {
      // 1. Lưu tin nhắn vào CSDL
      const [result] = await db.query(
        'INSERT INTO group_messages (senderId, groupId, content) VALUES (?, ?, ?)',
        [senderId, groupId, content]
      );
      const insertedId = result.insertId;
      // 2. Lấy lại đầy đủ tin nhắn vừa chèn
      const [newMsgRow] = await db.query('SELECT * FROM group_messages WHERE id = ?', [insertedId]);
      const newMsg = newMsgRow[0];
      // 3. Định nghĩa tên "phòng" (room)
      const roomName = `group_${groupId}`;
      // 4. Gửi tin nhắn đến TẤT CẢ thành viên trong phòng đó
      socket.broadcast.to(roomName).emit('newGroupMessage', {
        id: newMsg.id,
        senderId: newMsg.senderId,
        senderUsername: senderUsername,
        groupId: newMsg.groupId,
        content: newMsg.content,
        createdAt: newMsg.createdAt
      });
    } catch (err) {
      console.error('Lỗi khi xử lý groupMessage:', err);
      socket.emit('error', 'Không thể gửi tin nhắn nhóm.');
    }
  });

  // loadGroupHistory (Giữ nguyên)
  socket.on('loadGroupHistory', async ({ groupId }) => {
    try {
      // Dùng JOIN để lấy TÊN của người gửi
      const [messages] = await db.query(
        `SELECT
          gm.id,
          gm.senderId,
          gm.groupId,
          gm.content,
          gm.createdAt,
          u.username AS senderUsername 
        FROM group_messages gm
        JOIN users u ON gm.senderId = u.id
        WHERE gm.groupId = ?
        ORDER BY gm.createdAt ASC`,
        [groupId]
      );
      
      // Gửi lịch sử về cho client
      socket.emit('groupHistory', { groupId, messages });
      
    } catch (err) {
      console.error('Lỗi khi tải lịch sử nhóm:', err);
    }
  });

  // --- khi user ngắt kết nối (Giữ nguyên) ---
  socket.on('disconnect', () => {
    // Bọc trong một hàm async để có thể dùng await
    const handleDisconnect = async () => {
      try {
        console.log(`User ${myUsername} (ID: ${myUserId}) disconnected.`);
        delete onlineUsers[myUserId];

        await broadcastUpdatedUserList(); // Gọi hàm helper để gửi lại danh sách user
      } catch (err) {
        // (CẢI TIẾN) Nếu CSDL lỗi khi có người ngắt kết nối, chỉ ghi log chứ không làm sập server
        console.error('Lỗi CSDL khi cập nhật danh sách user sau khi disconnect:', err.message);
        // Trong trường hợp này, chúng ta không gửi gì cho client để tránh gây lỗi giao diện.
        // Trạng thái online/offline sẽ được đồng bộ lại ở lần kết nối/ngắt kết nối tiếp theo.
      }
    };

    handleDisconnect();
  });
}); // <-- đóng ngoặc cho io.on('connection', ...)


// --- Khởi động server (Giữ nguyên) ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Server đang chạy tại http://localhost:${PORT}`);
});