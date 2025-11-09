// Tên file: public/group-chat.js (ĐÃ CẤU TRÚC LẠI, PHỤ THUỘC MAIN.JS)

document.addEventListener('DOMContentLoaded', () => {
    // Chỉ chạy nếu đang ở trang chat
    if (window.location.pathname.endsWith('/chat.html')) {

        // --- DOM Elements cho Nhóm ---
        const groupListDiv = document.getElementById('group-list');
        const createGroupBtn = document.getElementById('create-group-btn');
        const modal = document.getElementById('create-group-modal');
        const modalUserList = document.getElementById('modal-user-list');
        const cancelCreateGroupBtn = document.getElementById('cancel-create-group');
        const confirmCreateGroupBtn = document.getElementById('confirm-create-group');
        const groupNameInput = document.getElementById('group-name-input');

        // Lấy token (cần thiết cho API)
        const token = localStorage.getItem('token');

       
        }

        // --- SOCKET LISTENERS (Chỉ dành cho nhóm) ---
        // (Chuyển sang main.js để quản lý tập trung, NHƯNG để ở đây cũng OK)
        
        // 1. Nhận danh sách nhóm từ server (khi bấm tab)
        window.socket.on('groupsList', (groups) => {
            window.allGroupsCache = groups;
            window.renderGroupListFromCache();

            // (MỚI) Kích hoạt lại chat nếu đang active
            if (window.currentChatContext.type === 'group') {
                const activeGroupItem = groupListDiv.querySelector(`[data-group-id="${window.currentChatContext.id}"]`);
                if (activeGroupItem) activeGroupItem.classList.add('active');
            }
        });

        // 2. Nhận thông tin về 1 nhóm mới (khi mình được thêm vào)
        window.socket.on('newGroupAdded', (newGroup) => {
            window.allGroupsCache.push(newGroup);
            window.renderGroupListFromCache();
            // (Nên thêm: thông báo)
            alert(`Bạn vừa được thêm vào nhóm mới: ${newGroup.name}`);
        });


        // --- LOGIC MODAL TẠO NHÓM ---

        // 1. Mở Modal: Hiển thị danh sách user từ cache
        createGroupBtn.addEventListener('click', () => {
            modalUserList.innerHTML = '';
            // Lấy danh sách user từ cache global (do main.js tạo)
            const users = Object.values(window.allUsersCache);
            
            users.forEach(user => {
                if (user.userId === window.myUserId) return; // Không tự thêm mình

                const item = document.createElement('label');
                item.className = 'modal-user-item';
                
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.value = user.userId;

                const avatar = document.createElement('div');
                avatar.className = 'user-avatar small';
                avatar.textContent = user.username.charAt(0).toUpperCase();

                const username = document.createElement('span');
                username.textContent = user.username;

                item.appendChild(checkbox);
                item.appendChild(avatar);
                item.appendChild(username);
                modalUserList.appendChild(item);
            });
            modal.classList.remove('hidden');
            groupNameInput.focus();
        });

        // 2. Đóng Modal
        cancelCreateGroupBtn.addEventListener('click', () => {
            modal.classList.add('hidden');
            groupNameInput.value = '';
        });

        // 3. Xác nhận Tạo Nhóm (Gửi API)
        confirmCreateGroupBtn.addEventListener('click', async () => {
            const groupName = groupNameInput.value.trim();
            const selectedUsers = [];
            
            // Lấy ID các user được chọn
            modalUserList.querySelectorAll('input[type="checkbox"]:checked').forEach(input => {
                selectedUsers.push(parseInt(input.value));
            });
            
            if (!groupName || selectedUsers.length === 0) {
                alert('Vui lòng nhập tên nhóm và chọn ít nhất 1 thành viên.');
                return;
            }

            try {
                // (Giữ nguyên fetch)
                const res = await fetch('/api/groups/create', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}` 
                    },
                    body: JSON.stringify({ name: groupName, members: selectedUsers })
                });

                const data = await res.json();
                if (!res.ok) {
                    throw new Error(data.message);
                }
                
                // Thành công!
                modal.classList.add('hidden');
                groupNameInput.value = '';
                
                // Không cần làm gì thêm. Server sẽ tự động gửi sự kiện 'newGroupAdded'
                // và socket listener (ở trên) sẽ bắt được và cập nhật UI.
                
            } catch (error) {
                alert(`Lỗi khi tạo nhóm: ${error.message}`);
            }
        });

    } // end if chat.html
}); // end DOMContentLoaded