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