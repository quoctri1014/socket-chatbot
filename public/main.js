// Tên file: public/main.js (PHIÊN BẢN HOÀN CHỈNH CUỐI CÙNG)
const path = window.location.pathname;

// --- LOGIC TRANG ĐĂNG NHẬP / ĐĂNG KÝ (Giữ nguyên) ---
if (path === '/' || path.endsWith('/index.html')) {
  const loginForm = document.getElementById('login-form');
  const loginError = document.getElementById('login-error');
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      loginError.textContent = '';
      const username = document.getElementById('login-username').value;
      const password = document.getElementById('login-password').value;
      try {
        const res = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message);
        localStorage.setItem('token', data.token);
        window.location.href = '/chat.html';
      } catch (error) {
        loginError.textContent = error.message;
      }
    });
  }
}

if (path.endsWith('/register.html')) {
  const registerForm = document.getElementById('register-form');
  const registerMessage = document.getElementById('register-message');
  if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      registerMessage.textContent = '';
      const username = document.getElementById('register-username').value;
      const password = document.getElementById('register-password').value;
      try {
        const res = await fetch('/api/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message);
        registerMessage.textContent = data.message + " Vui lòng chuyển sang trang đăng nhập.";
        registerMessage.style.color = 'green';
        registerForm.reset();
      } catch (error) {
        registerMessage.textContent = error.message;
        registerMessage.style.color = 'red';
      }
    });
  }
}

// --- LOGIC TRANG CHAT (TÁI CẤU TRÚC HOÀN TOÀN) ---
if (path.endsWith('/chat.html')) {
  const token = localStorage.getItem('token');
  if (!token) {
    window.location.href = '/index.html'; // Đẩy về trang đăng nhập
  }

  // --- BIẾN TOÀN CỤC ---
  window.socket = io({ auth: { token } });
  window.myUserId = null;
  window.myUsername = null;
  
  // Cache dữ liệu
  window.allUsersCache = {}; // Dùng object để truy cập nhanh bằng userId
  window.allGroupsCache = []; // Dùng array

  // Quản lý bối cảnh chat hiện tại
  // context: { type: 'user' | 'group', id: Number, name: String }
  window.currentChatContext = { type: null, id: null, name: null };

  // --- DOM Elements Toàn Cục ---
  window.messagesContainer = document.getElementById('messages');
  const userListDiv = document.getElementById('user-list');
  const chatHeader = document.getElementById('chat-header-title');
  const chatForm = document.getElementById('chat-form');
  const messageInput = document.getElementById('message-input');
  const sendButton = chatForm.querySelector('button[type="submit"]');
  const typingIndicator = document.getElementById('typing-indicator'); // (GĐ 2)
  const logoutButton = document.getElementById('logout-button');
  const myUsernameSpan = document.getElementById('my-username');
  const searchInput = document.getElementById('search-input');
  const themeToggle = document.getElementById('theme-toggle');
  const body = document.body;

  // --- LOGIC CHUNG (TAB, THEME, LOGOUT) ---

  // (GIAI ĐOẠN 2) Logic Typing Indicator
  let typingTimer;
  messageInput.addEventListener('input', () => {
    // Chỉ gửi khi đang chat 1-1 với người dùng khác
    if (window.currentChatContext.type === 'user' && window.currentChatContext.id !== 0) {
      // Gửi sự kiện 'typing' ngay lập tức
      window.socket.emit('typing', { recipientId: window.currentChatContext.id });

      // Đặt lại bộ đếm thời gian
      clearTimeout(typingTimer);
      typingTimer = setTimeout(() => {
        window.socket.emit('stopTyping', { recipientId: window.currentChatContext.id });
      }, 2000); // Gửi 'stopTyping' sau 2 giây không gõ
    }
  });

  // Lắng nghe sự kiện 'typing' từ người khác
  window.socket.on('typing', ({ senderId }) => {
    if (window.currentChatContext.type === 'user' && window.currentChatContext.id === senderId) {
      typingIndicator.textContent = `${window.currentChatContext.name} đang gõ...`;
      typingIndicator.classList.remove('hidden');
    }
  });

  window.socket.on('stopTyping', ({ senderId }) => {
    if (window.currentChatContext.type === 'user' && window.currentChatContext.id === senderId) {
      typingIndicator.classList.add('hidden');
    }
  });

    messageInput.addEventListener('keydown', (e) => {
        // 1. Kiểm tra xem phím nhấn có phải là 'Enter' VÀ không giữ phím 'Shift'
        if (e.key === 'Enter' && !e.shiftKey) {
          // 2. Ngăn hành vi mặc định (là xuống dòng)
          e.preventDefault();
          
          // 3. Kích hoạt sự kiện submit của form
          // (Cách này giống hệt như khi bạn bấm nút "Gửi")
          chatForm.requestSubmit(); 
        }
      });  

  // 1. Logic Theme (Sáng/Tối)
  function applySavedTheme() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    body.dataset.theme = savedTheme;
    themeToggle.textContent = savedTheme === 'light' ? '🌙' : '☀️';
    themeToggle.title = savedTheme === 'light' ? 'Chuyển sang Tối' : 'Chuyển sang Sáng';
  }
  themeToggle.addEventListener('click', () => {
    const newTheme = body.dataset.theme === 'light' ? 'dark' : 'light';
    body.dataset.theme = newTheme;
    localStorage.setItem('theme', newTheme);
    themeToggle.textContent = newTheme === 'light' ? '🌙' : '☀️';
    themeToggle.title = newTheme === 'light' ? 'Chuyển sang Tối' : 'Chuyển sang Sáng';
  });
  applySavedTheme();

  // 2. Logic Đăng xuất
  logoutButton.addEventListener('click', () => {
    localStorage.removeItem('token');
    window.socket.disconnect();
    window.location.href = '/index.html';
  });

  // 3. Logic chuyển Tab (User/Group) - ĐÃ SỬA LỖI MẤT DANH SÁCH
  const tabs = document.querySelectorAll('.sidebar-tab');
  
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      
      const tabName = tab.dataset.tab; // 'users' hoặc 'groups'
      
      // Lấy danh sách content MỚI NHẤT (Sửa lỗi)
      const tabContents = document.querySelectorAll('.tab-content'); 

      tabContents.forEach(content => {
        if (content.id === `${tabName}-list-container`) {
          content.classList.add('active');
        } else {
          content.classList.remove('active');
        }
      });

    });
  });

  // --- CÁC HÀM TIỆN ÍCH TOÀN CỤC ---

  // (MỚI) Hàm kích hoạt cửa sổ chat (dùng cho cả User và Group)
  window.activateChat = (context) => {
    window.currentChatContext = context;
    window.messagesContainer.innerHTML = ''; // Xóa tin nhắn cũ
    typingIndicator.classList.add('hidden'); // (GĐ 2) Ẩn chỉ báo typing khi đổi chat
    clearUnreadCount(context.type, context.id);
    // Cập nhật header
    chatHeader.textContent = context.name;

    // Kích hoạt form
    messageInput.disabled = false;
    sendButton.disabled = false;
    messageInput.placeholder = `Nhắn tin tới ${context.name}...`;
    messageInput.focus();

    // Loại bỏ 'active' khỏi tất cả item
    document.querySelectorAll('.user-item, .group-item').forEach(item => {
        item.classList.remove('active');
    });

    // Thêm 'active' cho item được chọn
    if (context.type === 'user') {
        const activeUserItem = userListDiv.querySelector(`[data-user-id="${context.id}"]`);
        if (activeUserItem) activeUserItem.classList.add('active');
    } else {
        // Hàm này sẽ được gọi từ group-chat.js
        window.highlightGroupItem(context.id); 
    }
  };

  // (MỚI) Hàm hiển thị tin nhắn (dùng cho cả 2 loại)
  window.displayMessage = (msgData, senderType) => {
    // msgData: { senderUsername, content, createdAt }
    const item = document.createElement('div');
    item.classList.add('message', senderType); // 'user' (mình) hoặc 'other'

    // (MỚI) Thêm tên người gửi (chỉ cho tin nhắn nhóm và là của 'other')
    if (window.currentChatContext.type === 'group' && senderType === 'other') {
        const senderName = document.createElement('div');
        senderName.classList.add('message-sender');
        senderName.textContent = msgData.senderUsername || '...';
        item.appendChild(senderName);
    }
    
    const text = document.createElement('div');
    text.classList.add('message-content');
    text.textContent = msgData.content;
    item.appendChild(text);

    if (msgData.createdAt) {
      const time = document.createElement('span');
      time.classList.add('timestamp');
      time.textContent = new Date(msgData.createdAt).toLocaleTimeString('vi-VN', { 
        hour: '2-digit', 
        minute: '2-digit' 
      });
      item.appendChild(time);
    }
    
    window.messagesContainer.appendChild(item);
    window.messagesContainer.scrollTop = window.messagesContainer.scrollHeight;
  }
  /**
   * Cập nhật (tăng) số tin nhắn chưa đọc
   * @param {string} type - 'user' hoặc 'group'
   * @param {number} id - ID của user hoặc group
   */
  function updateUnreadCount(type, id) {
    const selector = (type === 'user') 
      // Dùng querySelector cho #user-list bên trong main.js
      ? `#user-list .user-item[data-user-id="${id}"]` 
      // Giả sử group-list cũng có cấu trúc tương tự
      : `#groups-list-container .group-item[data-group-id="${id}"]`;
    
    // Dùng document.querySelector vì item có thể ở tab không active
    const chatItem = document.querySelector(selector);
    
    if (chatItem) {
      let badge = chatItem.querySelector('.unread-badge');
      
      // Nếu chưa có badge, tạo mới
      if (!badge) {
        badge = document.createElement('span');
        badge.classList.add('unread-badge');
        chatItem.appendChild(badge);
      }
      
      // Tăng số đếm
      const currentCount = parseInt(badge.textContent || '0');
      badge.textContent = currentCount + 1;
      badge.style.display = 'block'; // Hiển thị badge
    }
  }

  /**
   * Xóa (reset) số tin nhắn chưa đọc
   * @param {string} type - 'user' hoặc 'group'
   * @param {number} id - ID của user hoặc group
   */
  function clearUnreadCount(type, id) {
    const selector = (type === 'user') 
      ? `#user-list .user-item[data-user-id="${id}"]` 
      : `#groups-list-container .group-item[data-group-id="${id}"]`;

    const chatItem = document.querySelector(selector);
    
    if (chatItem) {
      const badge = chatItem.querySelector('.unread-badge');
      if (badge) {
        badge.textContent = '0';
        badge.style.display = 'none'; // Ẩn badge đi
      }
    }
  }

  // --- LOGIC SOCKET.IO (TRONG MAIN.JS) ---

  // 1. Khi kết nối thành công và được 'welcome'
  window.socket.on('welcome', (data) => {
    window.myUserId = data.userId;
    window.myUsername = data.username;
    myUsernameSpan.textContent = `Xin chào, ${window.myUsername}`;
  });

  // 2. Nhận danh sách user (cả online/offline) - ĐÃ CÓ AI
  window.socket.on('userList', (users) => {
    userListDiv.innerHTML = '';
    window.allUsersCache = {}; // Xây dựng lại cache
    
    // Sắp xếp: online lên trước, rồi theo tên
    users.sort((a, b) => {
        if (a.online !== b.online) return a.online ? -1 : 1;
        return a.username.localeCompare(b.username);
    });

    users.forEach(user => {
      window.allUsersCache[user.userId] = user; // Thêm vào cache
      
      const userItem = document.createElement('div');
      userItem.className = 'user-item';
      userItem.dataset.userId = user.userId;
      
      const avatar = document.createElement('div');
      avatar.className = 'user-avatar';
      // Nếu là AI (id=0), hiển thị icon robot, ngược lại hiển thị chữ cái
      avatar.textContent = (user.userId === 0) ? '🤖' : user.username.charAt(0).toUpperCase();

      // Thêm chấm trạng thái
      const statusDot = document.createElement('div');
      statusDot.className = `status-dot ${user.online ? 'online' : 'offline'}`;
      avatar.appendChild(statusDot);

      const userInfo = document.createElement('div');
      userInfo.className = 'user-info';
      const userName = document.createElement('div');
      userName.className = 'user-name';
      userName.textContent = user.username;
      
      const userPreview = document.createElement('div');
      userPreview.className = 'user-preview';
      // Nếu là AI, hiển thị mô tả, ngược lại hiển thị trạng thái
      userPreview.textContent = (user.userId === 0) ? 'Trợ lý AI' : (user.online ? 'Đang hoạt động' : 'Offline');
      
      userInfo.appendChild(userName);
      userInfo.appendChild(userPreview);
      userItem.appendChild(avatar);
      userItem.appendChild(userInfo);
      
      // Cập nhật click handler
      userItem.onclick = () => {
        const newContext = { 
            type: 'user', 
            id: user.userId, 
            name: user.username 
        };
        window.activateChat(newContext);
        
        // (SỬA) Phân biệt rạch ròi việc tải lịch sử
        if (user.userId === 0) {
          window.socket.emit('loadAIHistory'); // Sự kiện mới cho AI
        } else {
          window.socket.emit('loadPrivateHistory', { recipientId: user.userId }); // Sự kiện cũ cho người dùng
        }
      };

      userListDiv.appendChild(userItem);
    });
    
    // Kích hoạt lại chat nếu đang active
    if (window.currentChatContext.type === 'user') {
        const activeUserItem = userListDiv.querySelector(`[data-user-id="${window.currentChatContext.id}"]`);
        if (activeUserItem) activeUserItem.classList.add('active');
    }
  });

  // 3. Nhận danh sách NHÓM
  window.socket.on('groupList', (groups) => {
    window.allGroupsCache = groups; // Lưu vào cache
    window.renderGroupListFromCache(); // Gọi hàm render (từ group-chat.js)
  });

  // 3. Nhận lịch sử chat 1-1 (hoạt động cho cả AI)
  window.socket.on('privateHistory', ({ recipientId, messages }) => {
    // Chỉ hiển thị nếu đang chat với đúng người (hoặc AI)
    if (window.currentChatContext.type === 'user' && window.currentChatContext.id === recipientId) {
      window.messagesContainer.innerHTML = '';
      messages.forEach(msg => {
        // Nếu senderId = 0 (AI) hoặc khác myUserId -> 'other'
        const senderType = (msg.senderId === window.myUserId) ? 'user' : 'other';
        window.displayMessage({
            senderUsername: null, // Không cần cho chat 1-1
            content: msg.content,
            createdAt: msg.createdAt
        }, senderType);
      });
    }
  });

  // 4. Nhận tin nhắn 1-1 mới (hoạt động cho cả AI)
  window.socket.on('newMessage', (msg) => {
    // Chỉ hiển thị nếu đang chat với người gửi (hoặc AI)
    if (window.currentChatContext.type === 'user' && window.currentChatContext.id === msg.senderId) {
      window.displayMessage({
          senderUsername: null,
          content: msg.content,
          createdAt: msg.createdAt
      }, 'other'); // Tin nhắn mới 'newMessage' luôn là 'other'
    } else {
      updateUnreadCount('user', msg.senderId);
    }
  });

  // 5. Nhận lịch sử chat NHÓM
 window.socket.on('groupHistory', ({ groupId, messages }) => {
    // Chỉ hiển thị nếu đang chat với đúng nhóm
    if (window.currentChatContext.type === 'group' && window.currentChatContext.id === groupId) {
      window.messagesContainer.innerHTML = '';
      messages.forEach(msg => {
        const senderType = msg.senderId === window.myUserId ? 'user' : 'other';
        window.displayMessage({
          senderUsername: msg.senderUsername,
          content: msg.content,
          createdAt: msg.createdAt
        }, senderType);
      });
    }
    // ĐÃ XÓA DÒNG LỖI "messagesDiv.scrollTop"
  });

  // 6. Nhận tin nhắn NHÓM mới
window.socket.on('newGroupMessage', (msg) => {
    // Chỉ hiển thị nếu đang chat với đúng nhóm
    if (window.currentChatContext.type === 'group' && window.currentChatContext.id === msg.groupId) {
      const senderType = msg.senderId === window.myUserId ? 'user' : 'other';
      window.displayMessage({
        senderUsername: msg.senderUsername,
        content: msg.content,
        createdAt: msg.createdAt
      }, senderType);
    } else {
      // (Nên thêm: thông báo)
      updateUnreadCount('group', msg.groupId);
    }
    // (ĐÃ XÓA DÒNG LỖI "messagesDiv.scrollTop")
  });

  // 7. GỬI TIN NHẮN (Handler tổng)
  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const msg = messageInput.value.trim();
    
    if (!msg || window.currentChatContext.id === null) { // Sửa: check id không phải null
      return; // Không gửi nếu rỗng hoặc chưa chọn ai
    }
    
    const context = window.currentChatContext;

    // Hiển thị tin nhắn của MÌNH lên trước
    window.displayMessage({
        senderUsername: window.myUsername,
        content: msg,
        createdAt: new Date()
    }, 'user');

    // Gửi đi theo đúng context
    if (context.type === 'user') { // Nếu là chat 1-1
      // Phân biệt giữa chat với AI và người dùng thường
      if (context.id === 0) {
        // Gửi sự kiện chuyên biệt cho AI
        window.socket.emit('chatWithAI', { content: msg });
      } else {
        // Gửi tin nhắn riêng cho người dùng khác
        window.socket.emit('privateMessage', {
          recipientId: context.id,
          content: msg
        });
      }
    } else if (context.type === 'group') { // Nếu là chat nhóm
      window.socket.emit('groupMessage', {
        groupId: context.id,
        content: msg
      });
    }
    
    messageInput.value = '';
    messageInput.focus(); // (CẢI TIẾN) Tự động focus lại vào ô chat
  });

  // 8. Logic tìm kiếm (Đơn giản) - ĐÃ CẬP NHẬT
  searchInput.addEventListener('input', (e) => {
    const searchTerm = e.target.value.toLowerCase();
    
    // Lọc danh sách User
    document.querySelectorAll('#user-list .user-item').forEach(item => {
        const userNameElement = item.querySelector('.user-name');
        if (userNameElement) {
            const username = userNameElement.textContent.toLowerCase();
            item.style.display = username.includes(searchTerm) ? 'flex' : 'none';
        }
    });

    // Lọc danh sách Nhóm
    document.querySelectorAll('#group-list .group-item').forEach(item => {
        const groupNameElement = item.querySelector('.user-name');
        if (groupNameElement) {
            const groupName = groupNameElement.textContent.toLowerCase();
            item.style.display = groupName.includes(searchTerm) ? 'flex' : 'none';
        }
    });
  });

  // Xử lý lỗi Socket
  window.socket.on('connect_error', (err) => {
      console.error(err.message);
      if (err.message.includes('Xác thực thất bại')) {
          alert('Phiên đăng nhập hết hạn. Vui lòng đăng nhập lại.');
          localStorage.removeItem('token');
          window.location.href = '/index.html';
      }
  });

} // end if chat.html