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

        // --- HÀM RENDER DANH SÁCH NHÓM ---
        // Hàm này được gọi bởi socket event trong main.js
        window.renderGroupListFromCache = function() { 
            groupListDiv.innerHTML = '';

            if (!window.allGroupsCache || window.allGroupsCache.length === 0) {
                groupListDiv.innerHTML = '<p class="empty-list-msg">Bạn chưa tham gia nhóm nào.</p>';
                return;
            }

            window.allGroupsCache.forEach(group => {
                const groupItem = document.createElement('div');
                groupItem.className = 'group-item';
                
                const avatar = document.createElement('div');
                avatar.className = 'user-avatar';
                avatar.textContent = group.name.charAt(0).toUpperCase();

                const groupInfo = document.createElement('div');
                groupInfo.className = 'user-info';
                
                const groupName = document.createElement('div');
                groupName.className = 'user-name';
                groupName.textContent = group.name;
                
                const groupPreview = document.createElement('div');
                groupPreview.className = 'user-preview';
                groupPreview.textContent = 'Chat nhóm';
                
                groupInfo.appendChild(groupName);
                groupInfo.appendChild(groupPreview);
                groupItem.appendChild(avatar);
                groupItem.appendChild(groupInfo);
                groupItem.dataset.groupId = group.id;

                if (window.currentChatContext.type === 'group' && window.currentChatContext.id === group.id) {
                    groupItem.classList.add('active');
                }

                groupItem.onclick = () => {
                    const newContext = { type: 'group', id: group.id, name: group.name };
                    // Gọi hàm global từ main.js
                    window.activateChat(newContext); 
                    // Yêu cầu lịch sử nhóm (dùng socket global)
                    window.socket.emit('loadGroupHistory', { groupId: group.id });
                };
                groupListDiv.appendChild(groupItem);
            });
        }
        
        // (MỚI) Hàm highlight item (để main.js gọi)
        window.highlightGroupItem = function(groupId) {
             const activeGroupItem = groupListDiv.querySelector(`[data-group-id="${groupId}"]`);
             if (activeGroupItem) activeGroupItem.classList.add('active');
        }

        // Nhận thông tin về 1 nhóm mới (khi mình được thêm vào hoặc tự tạo)
        window.socket.on('newGroupAdded', (newGroup) => {
            window.allGroupsCache.push(newGroup);
            window.renderGroupListFromCache();
        });


        // --- LOGIC MODAL TẠO NHÓM ---

        // 1. Mở Modal: Hiển thị danh sách user từ cache
        createGroupBtn.addEventListener('click', async () => {
            modalUserList.innerHTML = '';
            // (SỬA) Lấy danh sách user từ cache global (do main.js tạo)
            // Nhanh hơn và không cần gọi API mỗi lần mở modal
            const users = Object.values(window.allUsersCache);
            
            users.forEach(user => {
                // Không cho phép thêm AI hoặc chính mình vào nhóm
                if (user.userId === window.myUserId || user.userId === 0) return; 

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