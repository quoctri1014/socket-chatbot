// Tên file: public/file-handler.js

document.addEventListener('DOMContentLoaded', () => {
    if (window.location.pathname.endsWith('/chat.html')) {
        
        const fileModal = document.getElementById('file-modal');
        const fileInput = document.getElementById('file-input');
        const cancelFileBtn = document.getElementById('cancel-file');
        const sendFileBtn = document.getElementById('send-file');
        const attachButton = document.getElementById('attach-button');
        const emojiPicker = document.getElementById('emoji-picker');
        const messageInput = document.getElementById('message-input');

        let selectedFiles = [];

        // Mở modal file
        attachButton.addEventListener('click', () => {
            fileInput.value = '';
            selectedFiles = [];
            fileModal.classList.remove('hidden');
        });

        // Đóng modal file
        cancelFileBtn.addEventListener('click', () => {
            fileModal.classList.add('hidden');
        });

        // Chọn file
        fileInput.addEventListener('change', (e) => {
            selectedFiles = Array.from(e.target.files);
        });

        // Gửi file
        sendFileBtn.addEventListener('click', async () => {
            if (selectedFiles.length === 0) {
                alert('Vui lòng chọn ít nhất một file.');
                return;
            }

            for (const file of selectedFiles) {
                await sendFile(file);
            }

            fileModal.classList.add('hidden');
        });

        /**
         * Gửi file qua socket (KHÔNG mã hóa)
         */
        async function sendFile(file) {
            return new Promise((resolve) => {
                const reader = new FileReader();
                
                reader.onload = function(e) {
                    const fileData = {
                        name: file.name,
                        type: file.type,
                        size: file.size,
                        data: e.target.result, // base64 data
                        timestamp: new Date().toISOString(),
                        isEncrypted: false // Đánh dấu file không mã hóa
                    };

                    const context = window.currentChatContext;
                    
                    if (context.type === 'user') {
                        window.socket.emit('fileMessage', {
                            recipientId: context.id,
                            file: fileData,
                            isImage: file.type.startsWith('image/')
                        });
                    } else if (context.type === 'group') {
                        window.socket.emit('groupFileMessage', {
                            groupId: context.id,
                            file: fileData,
                            isImage: file.type.startsWith('image/')
                        });
                    }

                    // Hiển thị ngay lập tức
                    displayFileMessage(fileData, true);
                    resolve();
                };
                
                reader.readAsDataURL(file);
            });
        }

        /**
         * Hiển thị tin nhắn file
         */
        window.displayFileMessage = function(fileData, isOwn = false) {
            const messageDiv = document.createElement('div');
            messageDiv.className = `message ${isOwn ? 'user' : 'recipient'}`;
            
            if (fileData.isImage) {
                messageDiv.classList.add('image-message');
                messageDiv.innerHTML = `
                    <img src="${fileData.data}" alt="${fileData.name}" />
                    <div class="timestamp">${new Date().toLocaleTimeString()}</div>
                `;
            } else {
                messageDiv.classList.add('file-message');
                messageDiv.innerHTML = `
                    <div class="file-info">
                        <div class="file-name">${fileData.name}</div>
                        <div class="file-size">${formatFileSize(fileData.size)}</div>
                        <a href="${fileData.data}" download="${fileData.name}" class="download-btn">
                            <i class="fas fa-download"></i> Tải xuống
                        </a>
                    </div>
                    <div class="timestamp">${new Date().toLocaleTimeString()}</div>
                `;
            }
            
            window.messagesContainer.appendChild(messageDiv);
            window.messagesContainer.scrollTop = window.messagesContainer.scrollHeight;
        };

        /**
         * Định dạng kích thước file
         */
        function formatFileSize(bytes) {
            if (bytes === 0) return '0 Bytes';
            const k = 1024;
            const sizes = ['Bytes', 'KB', 'MB', 'GB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
        }

        // --- EMOJI PICKER ---
        let isEmojiPickerVisible = false;

        // Toggle emoji picker
        const emojiButton = document.querySelector('.emoji-button');
        emojiButton.addEventListener('click', (e) => {
            e.preventDefault();
            isEmojiPickerVisible = !isEmojiPickerVisible;
            emojiPicker.classList.toggle('hidden', !isEmojiPickerVisible);
        });

        // Chọn emoji
        emojiPicker.querySelectorAll('.emoji-grid span').forEach(emoji => {
            emoji.addEventListener('click', () => {
                messageInput.value += emoji.textContent;
                messageInput.focus();
                emojiPicker.classList.add('hidden');
                isEmojiPickerVisible = false;
            });
        });

        // Đóng emoji picker khi click ra ngoài
        document.addEventListener('click', (e) => {
            if (!emojiPicker.contains(e.target) && !emojiButton.contains(e.target)) {
                emojiPicker.classList.add('hidden');
                isEmojiPickerVisible = false;
            }
        });

        // Xử lý nhận file message từ server
        window.socket.on('fileMessage', (msg) => {
            if (window.currentChatContext.type === 'user' && 
                window.currentChatContext.id === msg.senderId) {
                window.displayFileMessage(msg.file, false);
            } else {
                updateUnreadCount('user', msg.senderId);
            }
        });

        window.socket.on('groupFileMessage', (msg) => {
            if (window.currentChatContext.type === 'group' && 
                window.currentChatContext.id === msg.groupId) {
                window.displayFileMessage(msg.file, false);
            } else {
                updateUnreadCount('group', msg.groupId);
            }
        });

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

    }
});