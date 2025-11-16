// Tên file: public/main.js
const path = window.location.pathname;

// --- LOGIC TRANG ĐĂNG NHẬP / ĐĂNG KÝ ---
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

// --- LOGIC TRANG CHAT ---
if (path.endsWith('/chat.html')) {
  const token = localStorage.getItem('token');
  if (!token) {
    window.location.href = '/index.html';
  }

  // --- BIẾN TOÀN CỤC ---
  window.socket = io({ auth: { token } });
  window.myUserId = null;
  window.myUsername = null;
  
  // Cache dữ liệu
  window.allUsersCache = {};
  window.allGroupsCache = [];

  // Quản lý bối cảnh chat hiện tại
  window.currentChatContext = { type: null, id: null, name: null };

  // --- DOM Elements Toàn Cục ---
  window.messagesContainer = document.getElementById('messages');
  const userListDiv = document.getElementById('user-list');
  const chatHeader = document.getElementById('chat-header-title');
  const chatForm = document.getElementById('chat-form');
  const messageInput = document.getElementById('message-input');
  const sendButton = chatForm.querySelector('button[type="submit"]');
  const logoutButton = document.getElementById('logout-button');
  const myUsernameSpan = document.getElementById('my-username');
  const searchInput = document.getElementById('search-input');
  const themeToggle = document.getElementById('theme-toggle');
  const encryptionToggle = document.getElementById('encryption-toggle');
  const body = document.body;

  // --- LOGIC CHUNG (TAB, THEME, LOGOUT) ---

  messageInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
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

  // 2. Logic Encryption
  function initializeEncryption() {
    const useEncryption = localStorage.getItem('useEncryption') === 'true';
    encryptionToggle.innerHTML = useEncryption ? '🔒' : '🔓';
    encryptionToggle.title = useEncryption ? 'Mã hóa đang bật' : 'Mã hóa đang tắt';
    
    // Hiển thị thông báo
    const encryptionStatus = document.getElementById('encryption-status');
    if (useEncryption) {
        encryptionStatus.classList.remove('hidden');
        setTimeout(() => {
            encryptionStatus.classList.add('hidden');
        }, 3000);
    } else {
        encryptionStatus.classList.add('hidden');
    }
  }
  
  encryptionToggle.addEventListener('click', () => {
    const useEncryption = localStorage.getItem('useEncryption') !== 'true';
    localStorage.setItem('useEncryption', useEncryption);
    
    encryptionToggle.innerHTML = useEncryption ? '🔒' : '🔓';
    encryptionToggle.title = useEncryption ? 'Mã hóa đang bật' : 'Mã hóa đang tắt';
    
    // Hiển thị thông báo
    const encryptionStatus = document.getElementById('encryption-status');
    if (useEncryption) {
        encryptionStatus.classList.remove('hidden');
        setTimeout(() => {
            encryptionStatus.classList.add('hidden');
        }, 3000);
    } else {
        encryptionStatus.classList.add('hidden');
    }
    
    alert(`Mã hóa end-to-end ${useEncryption ? 'đã bật' : 'đã tắt'}\n\nLưu ý: Mã hóa chỉ áp dụng cho tin nhắn văn bản, không áp dụng cho file.`);
  });
  initializeEncryption();

  // 3. Logic Đăng xuất
  logoutButton.addEventListener('click', () => {
    localStorage.removeItem('token');
    window.socket.disconnect();
    window.location.href = '/index.html';
  });

  // 4. Logic chuyển Tab (User/Group)
  const tabs = document.querySelectorAll('.sidebar-tab');
  
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      
      const tabName = tab.dataset.tab;
      
      const tabContents = document.querySelectorAll('.tab-content'); 

      tabContents.forEach(content => {
        if (content.id === `${tabName}-list-container`) {
          content.classList.add('active');
        } else {
          content.classList.remove('active');
        }
      });

      if (tabName === 'groups') {
         window.socket.emit('loadGroups');
      }
    });
  });

  // --- CÁC HÀM TIỆN ÍCH TOÀN CỤC ---

  // Hàm kích hoạt cửa sổ chat
  window.activateChat = (context) => {
    window.currentChatContext = context;
    window.messagesContainer.innerHTML = '';
    clearUnreadCount(context.type, context.id);
    
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
        window.highlightGroupItem(context.id); 
    }
  };

  // Hàm hiển thị tin nhắn
  window.displayMessage = (msgData, senderType) => {
    const item = document.createElement('div');
    item.classList.add('message', senderType);

    if (window.currentChatContext.type === 'group' && senderType === 'recipient') {
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
   * Cập nhật số tin nhắn chưa đọc
   */
  function updateUnreadCount(type, id) {
    const selector = type === 'user' 
      ? `#user-list .user-item[data-user-id="${id}"]` 
      : `#group-list .group-item[data-group-id="${id}"]`;
    
    const chatItem = document.querySelector(selector);
    
    if (chatItem) {
      let badge = chatItem.querySelector('.unread-badge');
      
      if (!badge) {
        badge = document.createElement('span');
        badge.classList.add('unread-badge');
        chatItem.appendChild(badge);
      }
      
      const currentCount = parseInt(badge.textContent || '0');
      badge.textContent = currentCount + 1;
      badge.style.display = 'block';
    }
  }

  /**
   * Xóa số tin nhắn chưa đọc
   */
  function clearUnreadCount(type, id) {
    const selector = type === 'user' 
      ? `#user-list .user-item[data-user-id="${id}"]` 
      : `#group-list .group-item[data-group-id="${id}"]`;

    const chatItem = document.querySelector(selector);
    
    if (chatItem) {
      const badge = chatItem.querySelector('.unread-badge');
      if (badge) {
        badge.textContent = '0';
        badge.style.display = 'none';
      }
    }
  }

  // --- LOGIC SOCKET.IO (TRONG MAIN.JS) ---

  // Kiểm tra kết nối socket
  window.socket.on('connect', () => {
    console.log('✅ Đã kết nối socket');
  });

  window.socket.on('disconnect', () => {
    console.log('❌ Mất kết nối socket');
  });

  // 1. Khi kết nối thành công và được 'welcome'
  window.socket.on('welcome', (data) => {
    window.myUserId = data.userId;
    window.myUsername = data.username;
    myUsernameSpan.textContent = `Xin chào, ${window.myUsername}`;
    console.log('✅ Welcome:', data);
  });

  // 2. Nhận danh sách user
  window.socket.on('userList', (users) => {
    userListDiv.innerHTML = '';
    window.allUsersCache = {};
    
    users.sort((a, b) => {
        if (a.online !== b.online) return a.online ? -1 : 1;
        return a.username.localeCompare(b.username);
    });

    users.forEach(user => {
      window.allUsersCache[user.userId] = user;

      if (user.userId === window.myUserId) {
        return;
      }
      
      const userItem = document.createElement('div');
      userItem.className = 'user-item';
      userItem.dataset.userId = user.userId;
      
      const avatar = document.createElement('div');
      avatar.className = 'user-avatar';
      avatar.textContent = (user.userId === 0) ? '🤖' : user.username.charAt(0).toUpperCase();

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
      userPreview.textContent = (user.userId === 0) ? 'Trợ lý AI' : (user.online ? 'Đang hoạt động' : 'Offline');
      
      userInfo.appendChild(userName);
      userInfo.appendChild(userPreview);
      userItem.appendChild(avatar);
      userItem.appendChild(userInfo);
      
      userItem.onclick = () => {
        const newContext = { 
            type: 'user', 
            id: user.userId, 
            name: user.username 
        };
        window.activateChat(newContext);
        window.socket.emit('loadPrivateHistory', { recipientId: user.userId });
      };

      userListDiv.appendChild(userItem);
    });
    
    if (window.currentChatContext.type === 'user') {
        const activeUserItem = userListDiv.querySelector(`[data-user-id="${window.currentChatContext.id}"]`);
        if (activeUserItem) activeUserItem.classList.add('active');
    }
  });

  window.socket.on('groupList', (groups) => {
    console.log('Đã nhận danh sách nhóm:', groups);
    window.allGroupsCache = groups;
    if (window.renderGroupListFromCache) {
      window.renderGroupListFromCache();
    }
  });

  // 3. Nhận lịch sử chat 1-1 (ĐÃ SỬA LỖI ASYNC/AWAIT)
  window.socket.on('privateHistory', async ({ recipientId, messages }) => {
    if (window.currentChatContext.type === 'user' && window.currentChatContext.id === recipientId) {
      window.messagesContainer.innerHTML = '';
      
      for (const msg of messages) {
        const useEncryption = localStorage.getItem('useEncryption') === 'true';
        let content = msg.content;
        
        // Giải mã nếu tin nhắn được mã hóa
        if (useEncryption && window.encryptionService && window.encryptionService.isEncrypted(content)) {
          try {
            content = await window.encryptionService.decryptMessage(content);
          } catch (error) {
            console.error('Lỗi giải mã:', error);
            content = '[Không thể giải mã tin nhắn]';
          }
        }
        
        const senderType = (msg.senderId === window.myUserId) ? 'user' : 'recipient';
        window.displayMessage({
            senderUsername: null,
            content: content,
            createdAt: msg.createdAt
        }, senderType);
      }
    }
  });

  // 4. Nhận tin nhắn 1-1 mới
  window.socket.on('newMessage', async (msg) => {
    if (window.currentChatContext.type === 'user' && window.currentChatContext.id === msg.senderId) {
      const useEncryption = localStorage.getItem('useEncryption') === 'true';
      let content = msg.content;
      
      // Giải mã nếu tin nhắn được mã hóa
      if (useEncryption && msg.isEncrypted && window.encryptionService && window.encryptionService.isEncrypted(content)) {
        try {
          content = await window.encryptionService.decryptMessage(content);
        } catch (error) {
          console.error('Lỗi giải mã:', error);
          content = '[Không thể giải mã tin nhắn]';
        }
      }
      
      window.displayMessage({
          senderUsername: null,
          content: content,
          createdAt: msg.createdAt
      }, 'recipient');
    } else {
      updateUnreadCount('user', msg.senderId);
    }
  });

  // 5. Nhận lịch sử chat NHÓM (ĐÃ SỬA LỖI ASYNC/AWAIT)
  window.socket.on('groupHistory', async ({ groupId, messages }) => {
    if (window.currentChatContext.type === 'group' && window.currentChatContext.id === groupId) {
      window.messagesContainer.innerHTML = '';
      
      for (const msg of messages) {
        const useEncryption = localStorage.getItem('useEncryption') === 'true';
        let content = msg.content;
        
        if (useEncryption && window.encryptionService && window.encryptionService.isEncrypted(content)) {
          try {
            content = await window.encryptionService.decryptMessage(content);
          } catch (error) {
            console.error('Lỗi giải mã:', error);
            content = '[Không thể giải mã tin nhắn]';
          }
        }
        
        const senderType = msg.senderId === window.myUserId ? 'user' : 'recipient';
        window.displayMessage({
          senderUsername: msg.senderUsername,
          content: content,
          createdAt: msg.createdAt
        }, senderType);
      }
    }
  });

  // 6. Nhận tin nhắn NHÓM mới
  window.socket.on('newGroupMessage', async (msg) => {
    if (window.currentChatContext.type === 'group' && window.currentChatContext.id === msg.groupId) {
      const useEncryption = localStorage.getItem('useEncryption') === 'true';
      let content = msg.content;
      
      if (useEncryption && msg.isEncrypted && window.encryptionService && window.encryptionService.isEncrypted(content)) {
        try {
          content = await window.encryptionService.decryptMessage(content);
        } catch (error) {
          console.error('Lỗi giải mã:', error);
          content = '[Không thể giải mã tin nhắn]';
        }
      }
      
      const senderType = msg.senderId === window.myUserId ? 'user' : 'recipient';
      window.displayMessage({
        senderUsername: msg.senderUsername,
        content: content,
        createdAt: msg.createdAt
      }, senderType);
    } else {
      updateUnreadCount('group', msg.groupId);
    }
  });

  // 7. Nhận file messages (KHÔNG mã hóa)
  window.socket.on('fileMessage', (msg) => {
    console.log('📁 Nhận file message:', msg);
    if (window.currentChatContext.type === 'user' && 
        window.currentChatContext.id === msg.senderId) {
        if (window.displayFileMessage) {
          window.displayFileMessage(msg.file, false);
        }
    } else {
        updateUnreadCount('user', msg.senderId);
        // Hiển thị thông báo có file mới
        showFileNotification(msg.senderId, msg.file.name);
    }
  });

  // 8. Nhận group file messages (KHÔNG mã hóa)
  window.socket.on('groupFileMessage', (msg) => {
    console.log('📁 Nhận group file message:', msg);
    if (window.currentChatContext.type === 'group' && 
        window.currentChatContext.id === msg.groupId) {
        if (window.displayFileMessage) {
          window.displayFileMessage(msg.file, false);
        }
    } else {
        updateUnreadCount('group', msg.groupId);
        // Hiển thị thông báo có file mới
        showFileNotification(msg.groupId, msg.file.name, true);
    }
  });

  /**
   * Hiển thị thông báo file mới
   */
  function showFileNotification(chatId, fileName, isGroup = false) {
    const chatName = isGroup 
      ? window.allGroupsCache.find(g => g.id === chatId)?.name 
      : window.allUsersCache[chatId]?.username;
    
    if (chatName) {
      const notification = document.createElement('div');
      notification.className = 'file-notification';
      notification.innerHTML = `
        <strong>${chatName}</strong> đã gửi một file:<br>
        <small>${fileName}</small>
      `;
      document.body.appendChild(notification);
      
      setTimeout(() => {
        notification.remove();
      }, 5000);
    }
  }

  // 9. GỬI TIN NHẮN VĂN BẢN (Có mã hóa nếu bật)
  chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    let msg = messageInput.value.trim();
    
    if (!msg || window.currentChatContext.id === null) {
      return;
    }
    
    const context = window.currentChatContext;

    // Mã hóa tin nhắn văn bản nếu encryption được bật
    const useEncryption = localStorage.getItem('useEncryption') === 'true';
    let encryptedMsg = msg;
    
    if (useEncryption && window.encryptionService) {
      try {
        encryptedMsg = await window.encryptionService.encryptMessage(msg);
      } catch (error) {
        console.error('Lỗi mã hóa:', error);
        // Nếu mã hóa thất bại, gửi tin nhắn không mã hóa
        encryptedMsg = msg;
      }
    }

    // Hiển thị tin nhắn (giải mã để hiển thị nếu đã mã hóa)
    let displayMsg = msg;

    window.displayMessage({
        senderUsername: window.myUsername,
        content: displayMsg,
        createdAt: new Date(),
        isEncrypted: useEncryption
    }, 'user');

    // Gửi đi
    if (context.type === 'user') {
        window.socket.emit('privateMessage', {
            recipientId: context.id,
            content: encryptedMsg,
            isEncrypted: useEncryption
        });
    } else if (context.type === 'group') {
        window.socket.emit('groupMessage', {
            groupId: context.id,
            content: encryptedMsg,
            isEncrypted: useEncryption
        });
    }
    
    messageInput.value = '';
  });

  // 10. Logic tìm kiếm
  searchInput.addEventListener('input', (e) => {
    const searchTerm = e.target.value.toLowerCase();
    
    document.querySelectorAll('#user-list .user-item').forEach(item => {
        const userNameElement = item.querySelector('.user-name');
        if (userNameElement) {
            const username = userNameElement.textContent.toLowerCase();
            item.style.display = username.includes(searchTerm) ? 'flex' : 'none';
        }
    });

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
      console.error('Socket connect error:', err.message);
      if (err.message.includes('Xác thực thất bại')) {
          alert('Phiên đăng nhập hết hạn. Vui lòng đăng nhập lại.');
          localStorage.removeItem('token');
          window.location.href = '/index.html';
      }
  });

  // Xử lý lỗi xác thực
  window.socket.on('auth_error', (data) => {
      alert(data.message);
      localStorage.removeItem('token');
      window.location.href = '/index.html';
  });

  // Xử lý lỗi chung
  window.socket.on('error', (errorMessage) => {
      alert(`Lỗi: ${errorMessage}`);
  });

} // end if chat.html