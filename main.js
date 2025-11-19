const path = window.location.pathname;

// ============================================================
// 1. LOGIC TRANG ĐĂNG NHẬP
// ============================================================
if (path === '/' || path.endsWith('/index.html')) {
  const loginForm = document.getElementById('login-form');
  const messageDisplay = document.getElementById('auth-message') || document.getElementById('login-error');

  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (messageDisplay) {
        messageDisplay.textContent = '';
        messageDisplay.className = 'message-display';
      }

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
        if (messageDisplay) {
            messageDisplay.textContent = error.message;
            messageDisplay.classList.add('error');
        }
      }
    });
  }
}

// ============================================================
// 2. LOGIC TRANG ĐĂNG KÝ (3 BƯỚC: REGISTER -> OTP -> PROFILE)
// ============================================================
if (path.endsWith('/register.html')) {
  const messageDisplay = document.getElementById('auth-message');
  
  const step1Form = document.getElementById('step-1-form');
  const step2Form = document.getElementById('step-2-form');
  const step3Form = document.getElementById('step-3-form');
  const loginLink = document.getElementById('login-link');

  // Biến lưu tạm username để dùng qua các bước
  let tempUsername = '';

  // --- BƯỚC 1: Gửi thông tin & Email ---
  if (step1Form) {
    step1Form.addEventListener('submit', async (e) => {
      e.preventDefault();
      messageDisplay.textContent = 'Đang xử lý...';
      messageDisplay.className = 'message-display';

      const username = document.getElementById('reg-username').value;
      const password = document.getElementById('reg-password').value;
      const confirmPass = document.getElementById('reg-confirm-password').value;
      const email = document.getElementById('reg-email').value;

      if (password !== confirmPass) {
        messageDisplay.textContent = 'Mật khẩu nhập lại không khớp!';
        messageDisplay.classList.add('error');
        return;
      }

      try {
        const res = await fetch('/api/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password, email })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.message);

        // Thành công -> Chuyển sang Bước 2
        tempUsername = username; 
        
        messageDisplay.textContent = "Đã gửi mã OTP vào Email của bạn!";
        messageDisplay.classList.add('success');
        
        step1Form.classList.add('hidden');
        step2Form.classList.remove('hidden');
        loginLink.classList.add('hidden');

      } catch (error) {
        messageDisplay.textContent = error.message;
        messageDisplay.classList.add('error');
      }
    });
  }

  // --- BƯỚC 2: Xác minh OTP ---
  if (step2Form) {
    step2Form.addEventListener('submit', async (e) => {
      e.preventDefault();
      messageDisplay.textContent = '';
      
      const otp = document.getElementById('reg-otp').value;

      try {
        const res = await fetch('/api/verify-otp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: tempUsername, otp })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.message);

        // Thành công -> Chuyển sang Bước 3
        messageDisplay.textContent = "Xác minh đúng! Hãy đặt Nickname.";
        messageDisplay.classList.remove('error');
        messageDisplay.classList.add('success');

        step2Form.classList.add('hidden');
        step3Form.classList.remove('hidden');

      } catch (error) {
        messageDisplay.textContent = error.message;
        messageDisplay.classList.add('error');
      }
    });
  }

  // --- BƯỚC 3: Cập nhật Hồ sơ ---
  if (step3Form) {
    step3Form.addEventListener('submit', async (e) => {
        e.preventDefault();
        messageDisplay.textContent = '';

        const nickname = document.getElementById('reg-nickname').value;
        const avatar = document.getElementById('reg-avatar').value;

        try {
            const res = await fetch('/api/update-profile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: tempUsername, nickname, avatar })
            });
    
            const data = await res.json();
            if (!res.ok) throw new Error(data.message);
    
            // HOÀN TẤT
            messageDisplay.textContent = "Đăng ký hoàn tất! Đang chuyển hướng...";
            messageDisplay.classList.add('success');
            
            setTimeout(() => {
                window.location.href = '/index.html';
            }, 2000);
    
        } catch (error) {
            messageDisplay.textContent = error.message;
            messageDisplay.classList.add('error');
        }
    });
  }
}

// ============================================================
// 3. LOGIC TRANG CHAT (Giữ nguyên phần chat của bạn)
// ============================================================
if (path.endsWith('/chat.html')) {
  const token = localStorage.getItem('token');
  if (!token) {
    window.location.href = '/index.html'; 
  }

  window.socket = io({ auth: { token } });
  window.myUserId = null;
  window.myUsername = null;
  window.allUsersCache = {};
  window.allGroupsCache = [];
  window.currentChatContext = { type: null, id: null, name: null };

  window.messagesContainer = document.getElementById('messages');
  const userListDiv = document.getElementById('user-list');
  const chatHeader = document.getElementById('chat-header-title');
  const chatForm = document.getElementById('chat-form');
  const messageInput = document.getElementById('message-input');
  const logoutButton = document.getElementById('logout-button');
  const myUsernameSpan = document.getElementById('my-username');
  const searchInput = document.getElementById('search-input');
  const themeToggle = document.getElementById('theme-toggle');
  const body = document.body;

    messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          chatForm.requestSubmit(); 
        }
      });  

  function applySavedTheme() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    body.dataset.theme = savedTheme;
    themeToggle.textContent = savedTheme === 'light' ? '🌙' : '☀️';
  }
  themeToggle.addEventListener('click', () => {
    const newTheme = body.dataset.theme === 'light' ? 'dark' : 'light';
    body.dataset.theme = newTheme;
    localStorage.setItem('theme', newTheme);
    themeToggle.textContent = newTheme === 'light' ? '🌙' : '☀️';
  });
  applySavedTheme();

  logoutButton.addEventListener('click', () => {
    localStorage.removeItem('token');
    window.socket.disconnect();
    window.location.href = '/index.html';
  });

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

  window.activateChat = (context) => {
    window.currentChatContext = context;
    window.messagesContainer.innerHTML = ''; 
    chatHeader.textContent = context.name;
    messageInput.disabled = false;
    chatForm.querySelector('button').disabled = false;
    messageInput.placeholder = `Nhắn tin tới ${context.name}...`;
    messageInput.focus();

    document.querySelectorAll('.user-item, .group-item').forEach(item => {
        item.classList.remove('active');
    });
    if (context.type === 'user') {
        const activeUserItem = userListDiv.querySelector(`[data-user-id="${context.id}"]`);
        if (activeUserItem) activeUserItem.classList.add('active');
    } else {
        window.highlightGroupItem(context.id); 
    }
  };

  window.displayMessage = (msgData, senderType) => {
    const item = document.createElement('div');
    item.classList.add('message', senderType); 
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

  window.socket.on('welcome', (data) => {
    window.myUserId = data.userId;
    window.myUsername = data.username;
    myUsernameSpan.textContent = `Xin chào, ${window.myUsername}`;
  });

  window.socket.on('userList', (users) => {
    userListDiv.innerHTML = '';
    window.allUsersCache = {}; 
    users.sort((a, b) => {
        if (a.online !== b.online) return a.online ? -1 : 1;
        return a.username.localeCompare(b.username);
    });

    users.forEach(user => {
      if (user.userId === window.myUserId) {
        window.allUsersCache[user.userId] = user; 
        return;
      }
      window.allUsersCache[user.userId] = user; 
      
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
        const newContext = { type: 'user', id: user.userId, name: user.username };
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
      window.allGroupsCache = groups; 
      window.renderGroupListFromCache(); 
    });

  window.socket.on('privateHistory', ({ recipientId, messages }) => {
    if (window.currentChatContext.type === 'user' && window.currentChatContext.id === recipientId) {
      window.messagesContainer.innerHTML = '';
      messages.forEach(msg => {
        const senderType = (msg.senderId === window.myUserId) ? 'user' : 'other';
        window.displayMessage({
            senderUsername: null,
            content: msg.content,
            createdAt: msg.createdAt
        }, senderType);
      });
    }
  });

  window.socket.on('newMessage', (msg) => {
    if (window.currentChatContext.type === 'user' && window.currentChatContext.id === msg.senderId) {
      window.displayMessage({
          senderUsername: null,
          content: msg.content,
          createdAt: msg.createdAt
      }, 'other'); 
    } 
  });

 window.socket.on('groupHistory', ({ groupId, messages }) => {
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
  });

window.socket.on('newGroupMessage', (msg) => {
    if (window.currentChatContext.type === 'group' && window.currentChatContext.id === msg.groupId) {
      const senderType = msg.senderId === window.myUserId ? 'user' : 'other';
      window.displayMessage({
        senderUsername: msg.senderUsername,
        content: msg.content,
        createdAt: msg.createdAt
      }, senderType);
    } 
  });

  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const msg = messageInput.value.trim();
    if (!msg || window.currentChatContext.id === null) return; 
    
    const context = window.currentChatContext;

    window.displayMessage({
        senderUsername: window.myUsername,
        content: msg,
        createdAt: new Date()
    }, 'user');

    if (context.type === 'user') {
      window.socket.emit('privateMessage', {
        recipientId: context.id, 
        content: msg
      });
    } else if (context.type === 'group') {
      window.socket.emit('groupMessage', {
        groupId: context.id,
        content: msg
      });
    }
    messageInput.value = '';
  });

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

  window.socket.on('connect_error', (err) => {
      if (err.message.includes('Xác thực thất bại')) {
          localStorage.removeItem('token');
          window.location.href = '/index.html';
      }
  });
}