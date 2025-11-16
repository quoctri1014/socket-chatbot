import dotenv from "dotenv";
dotenv.config();
import express from "express";
import http from "http";
import { Server } from "socket.io";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import db from "./db.js";
import axios from "axios";
import { GoogleGenAI } from "@google/genai";

// API Keys
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const OPENWEATHER_API_KEY = process.env.OPENWEATHER_API_KEY;
const GEOAPIFY_API_KEY = process.env.GEOAPIFY_API_KEY;

console.log("🔑 Đang kiểm tra Key thời tiết:", OPENWEATHER_API_KEY);
console.log("🔑 Đang kiểm tra Key địa điểm:", GEOAPIFY_API_KEY);

if (!GEMINI_API_KEY) {
  console.error("ERROR: Missing GEMINI_API_KEY in .env");
  process.exit(1);
}

// Khởi tạo Gemini AI
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

const JWT_SECRET = "day_la_khoa_bi_mat_cua_ban";

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// in-memory online users map: { userId: { socketId, username } }
const onlineUsers = {};

/**
 * Lấy danh sách người dùng từ DB, kiểm tra trạng thái online và gửi đến tất cả clients.
 */
async function sendUserList() {
  try {
    const [users] = await db.query("SELECT id, username FROM users");

    const userList = users.map((user) => {
      let isOnline = !!onlineUsers[user.id];

      // Trợ lý AI (ID=0) luôn phải được coi là online
      if (user.id === 0) {
        isOnline = true;
      }

      return {
        userId: user.id,
        username: user.username,
        online: isOnline,
      };
    });

    io.emit("userList", userList);
  } catch (err) {
    console.error("Lỗi khi lấy danh sách người dùng (sendUserList):", err);
  }
}

// --- LOGIC TOOL API ---

// Hàm lấy thời tiết
async function getCurrentWeather(args) {
  const { city, units } = args;
  try {
    const response = await axios.get(
      `https://api.openweathermap.org/data/2.5/weather?q=${city}&units=${
        units === "celsius" ? "metric" : "imperial"
      }&appid=${OPENWEATHER_API_KEY}`
    );
    const weather = response.data;
    const result = {
      city: weather.name,
      temperature: weather.main.temp,
      description: weather.weather[0].description,
      humidity: weather.main.humidity,
      units: units,
    };
    return JSON.stringify(result);
  } catch (error) {
    if (error.response && error.response.status === 404) {
      return JSON.stringify({ error: `Không tìm thấy thành phố ${city}.` });
    }
    console.error("Lỗi khi gọi OpenWeatherMap:", error.message);
    return JSON.stringify({ error: "Lỗi không xác định khi lấy thời tiết." });
  }
}

// Hàm lấy tọa độ
async function getLocationCoordinates(args) {
  const { location } = args;
  try {
    const response = await axios.get(
      `https://api.geoapify.com/v1/geocode/search?text=${location}&apiKey=${GEOAPIFY_API_KEY}`
    );
    if (response.data.features && response.data.features.length > 0) {
      const feature = response.data.features[0];
      const result = {
        location: feature.properties.formatted,
        latitude: feature.properties.lat,
        longitude: feature.properties.lon,
      };
      return JSON.stringify(result);
    } else {
      return JSON.stringify({
        error: `Không tìm thấy tọa độ cho địa điểm: ${location}.`,
      });
    }
  } catch (error) {
    console.error("Lỗi khi gọi Geoapify:", error.message);
    return JSON.stringify({
      error: "Lỗi không xác định khi tìm kiếm địa điểm.",
    });
  }
}

const toolFunctions = {
  getCurrentWeather,
  getLocationCoordinates,
};

// Định nghĩa Tool
const toolDefinitions = [
  {
    type: "function",
    function: {
      name: "getCurrentWeather",
      description: "Lấy thông tin thời tiết hiện tại cho một thành phố cụ thể.",
      parameters: {
        type: "object",
        properties: {
          city: {
            type: "string",
            description: "Tên thành phố (ví dụ: 'Hanoi', 'Tokyo').",
          },
          units: {
            type: "string",
            enum: ["celsius", "fahrenheit"],
            description:
              "Đơn vị nhiệt độ mong muốn ('celsius' hoặc 'fahrenheit').",
          },
        },
        required: ["city"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "getLocationCoordinates",
      description:
        "Lấy tọa độ (latitude, longitude) của một địa điểm hoặc địa chỉ cụ thể.",
      parameters: {
        type: "object",
        properties: {
          location: {
            type: "string",
            description: "Địa điểm hoặc địa chỉ cần tìm tọa độ.",
          },
        },
        required: ["location"],
      },
    },
  },
];

// --- HÀM XỬ LÝ CHAT AI (HOÀN CHỈNH CHO GEMINI) ---
async function handleAIChat(userMessage, myUserId, myUsername) {
  const socket = onlineUsers[myUserId]
    ? io.sockets.sockets.get(onlineUsers[myUserId].socketId)
    : null;
  if (!socket) return;

  // 1. CHUYỂN ĐỔI TOOL DEFINITIONS sang định dạng Gemini
  const geminiTools = [
    {
      functionDeclarations: toolDefinitions.map((t) => t.function),
    },
  ];

  // 2. Định nghĩa System Instruction
  const systemInstruction = `Bạn là Trợ lý AI đa năng và thân thiện, có tên là Trợ lý AI. Bạn phải phản hồi bằng tiếng Việt.
  Bạn được phép sử dụng các Tool được định nghĩa để giúp người dùng. 
  Tên người dùng hiện tại là ${myUsername} (ID: ${myUserId}).
  `;

  // 3. Lấy lịch sử chat (Bộ nhớ) và chuyển đổi sang cấu trúc Gemini
  let historyMessages = [];
  try {
    const [history] = await db.query(
      `SELECT senderId, content, createdAt FROM messages WHERE (senderId = ? AND recipientId = 0) OR (senderId = 0 AND recipientId = ?) ORDER BY createdAt ASC LIMIT 10`,
      [myUserId, myUserId]
    );
    history.forEach((msg) => {
      // Gemini sử dụng 'model' thay vì 'assistant'
      const role = msg.senderId === myUserId ? "user" : "model";
      historyMessages.push({ role: role, parts: [{ text: msg.content }] });
    });
  } catch (err) {
    console.error("Lỗi khi lấy lịch sử chat AI:", err);
  }

  // 4. Thêm tin nhắn mới của người dùng
  historyMessages.push({ role: "user", parts: [{ text: userMessage }] });

  // 5. GỌI GEMINI (Function Calling được xử lý trong vòng lặp)
  try {
    let currentMessages = historyMessages;
    let aiResponseContent = "";
    let iterations = 0;

    // Lần gọi đầu tiên (hoặc vòng lặp)
    let response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: currentMessages,
      config: {
        tools: geminiTools,
        systemInstruction: systemInstruction,
      },
    });

    // Vòng lặp xử lý Function Calling
    while (
      response.functionCalls &&
      response.functionCalls.length > 0 &&
      iterations < 5
    ) {
      iterations++;

      // Thêm phản hồi của AI (yêu cầu tool) vào lịch sử
      currentMessages.push(response.candidates[0].content);

      // Thực thi tất cả các tool calls
      let toolResponses = [];
      for (const call of response.functionCalls) {
        const functionName = call.name;
        const functionToCall = toolFunctions[functionName];
        const functionArgs = call.args;

        console.log(
          `AI (Gemini) đang gọi tool: ${functionName} với args:`,
          functionArgs
        );

        // Thực thi tool (hàm trả về JSON string)
        const toolResponseContent = await functionToCall(functionArgs);

        // Thêm kết quả vào mảng để gửi lại cho Gemini
        toolResponses.push({
          functionResponse: {
            name: functionName,
            response: {
              name: functionName,
              content: toolResponseContent, // Nội dung kết quả Tool
            },
          },
        });
      }

      // Thêm kết quả tool vào lịch sử
      currentMessages.push({
        role: "tool", // Role cho kết quả Tool
        parts: toolResponses,
      });

      // GỌI GEMINI LẦN TIẾP THEO (với kết quả Tool)
      response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: currentMessages,
        config: {
          tools: geminiTools,
          systemInstruction: systemInstruction,
        },
      });
    } // Kết thúc vòng lặp Tool

    // 6. LẤY PHẢN HỒI CUỐI CÙNG
    aiResponseContent = response.text;

    // 7. LƯU VÀ GỬI TIN NHẮN CUỐI CÙNG
    const [result] = await db.query(
      `INSERT INTO messages (senderId, recipientId, content) VALUES (?, ?, ?)`,
      [0, myUserId, aiResponseContent]
    );

    // Gửi tin nhắn về client
    socket.emit("newMessage", {
      id: result.insertId,
      senderId: 0,
      recipientId: myUserId,
      content: aiResponseContent,
      createdAt: new Date(),
      isEncrypted: false // AI messages không mã hóa
    });
  } catch (error) {
    console.error("Lỗi khi gọi Gemini (handleAIChat):", error);
    let errorMessage =
      "Trợ lý AI đang gặp lỗi kết nối (Gemini API Error). Vui lòng thử lại sau.";

    // Bắt lỗi Quota/API
    if (
      error.message &&
      (error.message.includes("429") ||
        error.message.includes("quota") ||
        error.message.includes("API key not valid"))
    ) {
      errorMessage =
        "Xin lỗi, dịch vụ AI đã hết hạn mức sử dụng hoặc Key API không hợp lệ. Vui lòng kiểm tra lại GEMINI_API_KEY.";
    }
    socket.emit("error", errorMessage);
  }
}

// --- API ROUTES ---
app.use(express.json());
app.use(express.static("public"));

// Middleware xác thực token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (token == null) return res.sendStatus(401);

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

// Route Đăng ký
app.post("/api/register", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ message: "Vui lòng điền đủ thông tin." });

    const [existingUser] = await db.query(
      "SELECT id FROM users WHERE username = ?",
      [username]
    );
    if (existingUser.length > 0) {
      return res.status(409).json({ message: "Tên người dùng đã tồn tại." });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await db.query("INSERT INTO users (username, passwordHash) VALUES (?, ?)", [
      username,
      passwordHash,
    ]);

    res.status(201).json({ message: "Đăng ký thành công!" });
  } catch (error) {
    console.error("Lỗi đăng ký:", error);
    res.status(500).json({ message: "Lỗi server." });
  }
});

// Route Đăng nhập
app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    const [users] = await db.query(
      "SELECT id, username, passwordHash FROM users WHERE username = ?",
      [username]
    );
    const user = users[0];

    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res
        .status(401)
        .json({ message: "Sai tên người dùng hoặc mật khẩu." });
    }

    // Tăng thời gian hết hạn lên 90 ngày
    const token = jwt.sign(
      { userId: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: "90d" }
    );
    res.json({ token, userId: user.id, username: user.username });
  } catch (error) {
    console.error("Lỗi đăng nhập:", error);
    res.status(500).json({ message: "Lỗi server." });
  }
});

// Route tạo nhóm
app.post("/api/groups/create", authenticateToken, async (req, res) => {
  const { name, members } = req.body;
  const creatorId = req.user.userId;

  if (!name || !members || members.length === 0) {
    return res.status(400).json({ message: "Thiếu tên nhóm hoặc thành viên." });
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    // 1. Tạo nhóm
    const [groupResult] = await connection.query(
      "INSERT INTO groups (name, creatorId) VALUES (?, ?)",
      [name, creatorId]
    );
    const groupId = groupResult.insertId;

    // 2. Thêm thành viên (bao gồm người tạo)
    const allMembers = Array.from(new Set([...members, creatorId])); // unique array
    const memberValues = allMembers.map((userId) => [groupId, userId]);

    await connection.query(
      `INSERT IGNORE INTO group_members (groupId, userId) VALUES ${memberValues
        .map(() => "(?, ?)")
        .join(", ")}`,
      memberValues.flat()
    );

    await connection.commit();

    // Thông báo cho tất cả users có liên quan
    const onlineMemberSockets = allMembers
      .filter((id) => onlineUsers[id])
      .map((id) => onlineUsers[id].socketId);

    onlineMemberSockets.forEach((socketId) => {
      const memberSocket = io.sockets.sockets.get(socketId);
      if (memberSocket) {
        memberSocket.emit("groupAdded", {
          id: groupId,
          name,
          creatorId,
          members: allMembers,
        });
      }
    });

    res.status(201).json({ message: "Tạo nhóm thành công!", groupId });
  } catch (error) {
    await connection.rollback();
    console.error("Lỗi khi tạo nhóm:", error);
    res.status(500).json({ message: "Lỗi server khi tạo nhóm." });
  } finally {
    connection.release();
  }
});

// --- SOCKET.IO HANDLER ---
io.on("connection", async (socket) => {
  const token = socket.handshake.auth.token;
  let myUserId = null;
  let myUsername = null;

  if (token) {
    try {
      const user = jwt.verify(token, JWT_SECRET);
      myUserId = user.userId;
      myUsername = user.username;
    } catch (err) {
      console.error("Socket Auth Error:", err.message);

      // Sử dụng sự kiện tùy chỉnh 'auth_error'
      socket.emit("auth_error", {
        message: "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.",
      });

      socket.disconnect(true);
      return;
    }
  }

  if (!myUserId) {
    // Sử dụng sự kiện tùy chỉnh 'auth_error'
    socket.emit("auth_error", {
      message: "Chưa đăng nhập. Truy cập bị từ chối.",
    });
    socket.disconnect(true);
    return;
  }

  // Thêm user vào danh sách online
  onlineUsers[myUserId] = { socketId: socket.id, username: myUsername };
  console.log(
    `User ${myUsername} (ID: ${myUserId}) connected. Socket ID: ${socket.id}`
  );

  // Chào mừng
  socket.emit("welcome", { userId: myUserId, username: myUsername });

  // Cập nhật danh sách user
  sendUserList();

  // Gửi danh sách nhóm (chỉ cho user này)
  socket.on("loadGroups", async () => {
    try {
      const [groups] = await db.query(
        `SELECT g.id, g.name, g.creatorId 
           FROM groups g 
           JOIN group_members gm ON g.id = gm.groupId 
           WHERE gm.userId = ? 
           ORDER BY g.createdAt DESC`,
        [myUserId]
      );
      socket.emit("groupList", groups);
    } catch (err) {
      console.error("Lỗi khi tải danh sách nhóm:", err);
    }
  });

  // --- Xử lý tin nhắn 1-1 ---
  socket.on("privateMessage", async (msgData) => {
    const { recipientId, content, isEncrypted } = msgData;

    try {
      // 1. Lưu vào DB
      const [result] = await db.query(
        "INSERT INTO messages (senderId, recipientId, content, type) VALUES (?, ?, ?, ?)",
        [myUserId, recipientId, content, 'text']
      );

      const newMsg = {
        id: result.insertId,
        senderId: myUserId,
        recipientId: recipientId,
        content: content,
        isEncrypted: isEncrypted || false,
        createdAt: new Date(),
      };

      // 2. Xử lý chat với AI
      if (recipientId === 0) {
        handleAIChat(content, myUserId, myUsername);
        return;
      }

      // 2a. Gửi tin nhắn đến người gửi (để hiển thị ngay)
      socket.emit("newMessage", newMsg);

      // 3. Gửi tin nhắn đến người nhận nếu họ online
      const recipient = onlineUsers[recipientId];
      if (recipient) {
        const recipientSocket = io.sockets.sockets.get(recipient.socketId);
        if (recipientSocket) {
          recipientSocket.emit("newMessage", newMsg);
        }
      }
    } catch (err) {
      console.error("Lỗi khi xử lý privateMessage:", err);
      socket.emit("error", "Không thể gửi tin nhắn.");
    }
  });

  // loadPrivateHistory
  socket.on("loadPrivateHistory", async ({ recipientId }) => {
    try {
      const [messages] = await db.query(
        `SELECT id, senderId, content, createdAt, type 
         FROM messages 
         WHERE (senderId = ? AND recipientId = ?) OR (senderId = ? AND recipientId = ?) 
         ORDER BY createdAt ASC`,
        [myUserId, recipientId, recipientId, myUserId]
      );

      socket.emit("privateHistory", { recipientId, messages });
    } catch (err) {
      console.error("Lỗi khi tải lịch sử 1-1:", err);
    }
  });

  // --- Xử lý tin nhắn nhóm ---
  socket.on("groupMessage", async (msgData) => {
    const { groupId, content, isEncrypted } = msgData;

    try {
      // 1. Kiểm tra thành viên nhóm
      const [memberCheck] = await db.query(
        "SELECT 1 FROM group_members WHERE groupId = ? AND userId = ?",
        [groupId, myUserId]
      );
      if (memberCheck.length === 0) {
        return socket.emit(
          "error",
          "Bạn không phải là thành viên của nhóm này."
        );
      }

      // 2. Lưu vào DB
      const [result] = await db.query(
        "INSERT INTO group_messages (groupId, senderId, content, type) VALUES (?, ?, ?, ?)",
        [groupId, myUserId, content, 'text']
      );

      const newMsg = {
        id: result.insertId,
        groupId: groupId,
        senderId: myUserId,
        senderUsername: myUsername,
        content: content,
        isEncrypted: isEncrypted || false,
        createdAt: new Date(),
      };

      // 3. Lấy tất cả thành viên của nhóm
      const [members] = await db.query(
        "SELECT userId FROM group_members WHERE groupId = ?",
        [groupId]
      );

      // 4. Gửi tin nhắn đến tất cả thành viên online
      members.forEach((member) => {
        const memberId = member.userId;
        const onlineMember = onlineUsers[memberId];
        if (onlineMember) {
          const memberSocket = io.sockets.sockets.get(onlineMember.socketId);
          if (memberSocket) {
            memberSocket.emit("newGroupMessage", newMsg);
          }
        }
      });
    } catch (err) {
      console.error("Lỗi khi xử lý groupMessage:", err);
      socket.emit("error", "Không thể gửi tin nhắn nhóm.");
    }
  });

  // loadGroupHistory
  socket.on("loadGroupHistory", async ({ groupId }) => {
    try {
      const [messages] = await db.query(
        `SELECT
          gm.id,
          gm.senderId,
          gm.groupId,
          gm.content,
          gm.createdAt,
          gm.type,
          u.username AS senderUsername 
        FROM group_messages gm
        JOIN users u ON gm.senderId = u.id
        WHERE gm.groupId = ?
        ORDER BY gm.createdAt ASC`,
        [groupId]
      );

      socket.emit("groupHistory", { groupId, messages });
    } catch (err) {
      console.error("Lỗi khi tải lịch sử nhóm:", err);
    }
  });

  // --- WebRTC Signaling ---
  socket.on("webrtcSignal", (data) => {
    const targetUser = onlineUsers[data.targetId];
    if (targetUser) {
      const targetSocket = io.sockets.sockets.get(targetUser.socketId);
      if (targetSocket) {
        targetSocket.emit("webrtcSignal", {
          ...data,
          senderId: myUserId
        });
      }
    }
  });

  // --- File Messages (KHÔNG mã hóa) ---
  socket.on("fileMessage", async (msgData) => {
    const { recipientId, file, isImage } = msgData;
    
    try {
      // Lưu thông tin file vào DB
      const [result] = await db.query(
        "INSERT INTO messages (senderId, recipientId, content, type) VALUES (?, ?, ?, ?)",
        [myUserId, recipientId, JSON.stringify(file), isImage ? 'image' : 'file']
      );

      const newMsg = {
        id: result.insertId,
        senderId: myUserId,
        recipientId: recipientId,
        file: file,
        isImage: isImage,
        type: isImage ? 'image' : 'file',
        createdAt: new Date(),
        isEncrypted: false // File không mã hóa
      };

      // Gửi đến người nhận
      const recipient = onlineUsers[recipientId];
      if (recipient) {
        const recipientSocket = io.sockets.sockets.get(recipient.socketId);
        if (recipientSocket) {
          recipientSocket.emit("fileMessage", newMsg);
        }
      }

      // Gửi lại cho người gửi để hiển thị
      socket.emit("fileMessage", newMsg);

    } catch (err) {
      console.error("Lỗi khi gửi file:", err);
      socket.emit("error", "Không thể gửi file.");
    }
  });

  // Group file messages (KHÔNG mã hóa)
  socket.on("groupFileMessage", async (msgData) => {
    const { groupId, file, isImage } = msgData;
    
    try {
      // Kiểm tra thành viên nhóm
      const [memberCheck] = await db.query(
        "SELECT 1 FROM group_members WHERE groupId = ? AND userId = ?",
        [groupId, myUserId]
      );
      if (memberCheck.length === 0) return;

      // Lưu vào DB
      const [result] = await db.query(
        "INSERT INTO group_messages (groupId, senderId, content, type) VALUES (?, ?, ?, ?)",
        [groupId, myUserId, JSON.stringify(file), isImage ? 'image' : 'file']
      );

      const newMsg = {
        id: result.insertId,
        groupId: groupId,
        senderId: myUserId,
        senderUsername: myUsername,
        file: file,
        isImage: isImage,
        type: isImage ? 'image' : 'file',
        createdAt: new Date(),
        isEncrypted: false // File không mã hóa
      };

      // Gửi đến tất cả thành viên
      const [members] = await db.query(
        "SELECT userId FROM group_members WHERE groupId = ?",
        [groupId]
      );

      members.forEach((member) => {
        const memberId = member.userId;
        const onlineMember = onlineUsers[memberId];
        if (onlineMember) {
          const memberSocket = io.sockets.sockets.get(onlineMember.socketId);
          if (memberSocket) {
            memberSocket.emit("groupFileMessage", newMsg);
          }
        }
      });

    } catch (err) {
      console.error("Lỗi khi gửi file nhóm:", err);
      socket.emit("error", "Không thể gửi file.");
    }
  });

  // --- khi user ngắt kết nối ---
  socket.on("disconnect", () => {
    if (myUserId) {
      console.log(`User ${myUsername} (ID: ${myUserId}) disconnected.`);
      delete onlineUsers[myUserId];
      sendUserList();
    }
  });
});

// --- Khởi động Server ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server đang chạy trên cổng ${PORT}`);
  console.log(`📱 Truy cập: http://localhost:${PORT}`);
});