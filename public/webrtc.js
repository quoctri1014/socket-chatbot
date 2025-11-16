// Tên file: public/webrtc.js

document.addEventListener('DOMContentLoaded', () => {
    const path = window.location.pathname;

    if (path.endsWith('/chat.html')) {
        // --- CẤU HÌNH & BIẾN TOÀN CỤC ---
        
        // Cấu hình ICE Servers (Sử dụng Google STUN/TURN servers)
        const iceConfig = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                // Thêm các TURN server nếu cần cho NAT xuyên tường lửa phức tạp
            ]
        };

        // Biến toàn cục WebRTC
        window.peerConnection = null;
        window.localStream = null;
        window.callTargetId = null; // userId của người đang gọi hoặc được gọi
        window.isVideoCall = false;

        // DOM Elements
        const callModal = document.getElementById('call-modal');
        const callStatus = document.getElementById('call-status');
        const localVideo = document.getElementById('local-video');
        const remoteVideo = document.getElementById('remote-video');
        const hangupButton = document.getElementById('hangup-button');
        const answerButton = document.getElementById('answer-call-button');
        const toggleMicButton = document.getElementById('toggle-mic-button');
        const toggleCameraButton = document.getElementById('toggle-camera-button');
        const phoneCallButton = document.getElementById('phone-call-button');
        const videoCallButton = document.getElementById('video-call-button');


        // --- CÁC HÀM XỬ LÝ MEDIA VÀ PC ---

        /**
         * Khởi tạo stream (micro/camera)
         * @param {boolean} withVideo - Có bật camera không.
         */
        async function initLocalStream(withVideo = true) {
            try {
                window.localStream = await navigator.mediaDevices.getUserMedia({
                    video: withVideo,
                    audio: true,
                });
                localVideo.srcObject = window.localStream;
                window.isVideoCall = withVideo;
                
                // Cập nhật trạng thái nút
                updateCallButtons(true, withVideo);

            } catch (err) {
                console.error('Lỗi khi lấy media:', err);
                alert('Không thể truy cập Microphone hoặc Camera. Vui lòng kiểm tra quyền.');
                throw err;
            }
        }

        /**
         * Tạo RTCPeerConnection và cấu hình các sự kiện.
         * @param {boolean} withVideo - Có bật video không.
         */
        function createPeerConnection(withVideo = true) {
            if (window.peerConnection) return window.peerConnection;

            const pc = new RTCPeerConnection(iceConfig);

            // 1. Gửi ICE Candidates qua socket
            pc.onicecandidate = (event) => {
                if (event.candidate) {
                    window.socket.emit('webrtcSignal', {
                        type: 'iceCandidate',
                        targetId: window.callTargetId,
                        candidate: event.candidate,
                    });
                }
            };

            // 2. Nhận remote stream (stream của đối phương)
            pc.ontrack = (event) => {
                if (remoteVideo.srcObject !== event.streams[0]) {
                    remoteVideo.srcObject = event.streams[0];
                    console.log('Remote stream received');
                    
                    // Cập nhật UI khi kết nối thành công (stream đã bắt đầu)
                    callStatus.textContent = withVideo ? 'Đã kết nối (Video Call)' : 'Đã kết nối (Voice Call)';
                    answerButton.classList.add('hidden'); // Ẩn nút trả lời

                    // Hiển thị remote video nếu là video call
                    remoteVideo.style.display = withVideo ? 'block' : 'none';
                    localVideo.style.display = withVideo ? 'block' : 'none';

                }
            };
            
            // 3. Thêm local stream vào PC
            if (window.localStream) {
                window.localStream.getTracks().forEach(track => {
                    pc.addTrack(track, window.localStream);
                });
            }

            // 4. Khi kết nối thay đổi trạng thái
            pc.oniceconnectionstatechange = () => {
                console.log(`ICE state: ${pc.iceConnectionState}`);
                if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'closed') {
                    // Tự động ngắt cuộc gọi nếu kết nối thất bại
                    hangupCall();
                }
            };

            window.peerConnection = pc;
            return pc;
        }
        
        // --- LOGIC CUỘC GỌI ---

        /**
         * Bắt đầu cuộc gọi (Người gọi)
         * @param {boolean} isVideo - Là video call hay voice call.
         */
        window.startCall = async (isVideo) => {
            const targetId = window.currentChatContext.id;
            const targetUsername = window.allUsersCache[targetId]?.username || 'Người dùng';

            if (!targetId || window.currentChatContext.type !== 'user') {
                alert('Vui lòng chọn một người dùng để gọi.');
                return;
            }
            if (window.peerConnection) {
                alert('Bạn đang có một cuộc gọi khác.');
                return;
            }
            
            window.callTargetId = targetId;
            window.isVideoCall = isVideo;

            try {
                // 1. Khởi tạo Stream
                await initLocalStream(isVideo);
                
                // 2. Khởi tạo RTCPeerConnection và thêm track
                const pc = createPeerConnection(isVideo);

                // 3. Tạo Offer (SDP)
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);

                // 4. Gửi Offer qua Socket.IO (Signaling)
                window.socket.emit('webrtcSignal', {
                    type: 'offer',
                    targetId: targetId,
                    offer: pc.localDescription,
                    isVideoCall: isVideo,
                });
                
                // Cập nhật UI
                callStatus.textContent = `Đang chờ ${targetUsername} chấp nhận cuộc gọi ${isVideo ? 'Video' : 'Voice'}...`;
                answerButton.classList.add('hidden');
                callModal.classList.remove('hidden');

            } catch (err) {
                console.error('Lỗi khi bắt đầu cuộc gọi:', err);
                hangupCall();
            }
        };

        /**
         * Trả lời cuộc gọi (Người nhận)
         */
        async function answerCall() {
            if (!window.peerConnection) return; // Đã xử lý trong callOffer listener
            
            callStatus.textContent = window.isVideoCall ? 'Đang kết nối Video...' : 'Đang kết nối Voice...';
            answerButton.classList.add('hidden'); // Ẩn nút trả lời
            
            try {
                // Đã có local stream và remote description từ callOffer listener
                
                // 1. Tạo Answer (SDP)
                const answer = await window.peerConnection.createAnswer();
                await window.peerConnection.setLocalDescription(answer);

                // 2. Gửi Answer qua Socket.IO
                window.socket.emit('webrtcSignal', {
                    type: 'answer',
                    targetId: window.callTargetId,
                    answer: answer,
                });

            } catch (err) {
                console.error('Lỗi khi trả lời cuộc gọi:', err);
                hangupCall();
            }
        }
        
        /**
         * Kết thúc cuộc gọi
         */
        window.hangupCall = function() {
            if (window.peerConnection) {
                window.peerConnection.close();
                window.peerConnection = null;
            }

            if (window.localStream) {
                window.localStream.getTracks().forEach(track => track.stop());
                window.localStream = null;
            }

            window.callTargetId = null;
            localVideo.srcObject = null;
            remoteVideo.srcObject = null;
            callModal.classList.add('hidden');
            
            // Báo hiệu kết thúc cho đối phương (nếu đang trong cuộc gọi)
            window.socket.emit('webrtcSignal', {
                type: 'hangup',
                targetId: window.callTargetId,
            });
            
            updateCallButtons(false, false); // Reset nút
            console.log('Cuộc gọi đã kết thúc.');
        };
        
        // --- XỬ LÝ NÚT BẤM VÀ UI ---

        phoneCallButton.addEventListener('click', () => window.startCall(false)); // false = Audio-only
        videoCallButton.addEventListener('click', () => window.startCall(true));  // true = Video

        hangupButton.addEventListener('click', window.hangupCall);
        answerButton.addEventListener('click', answerCall);
        
        toggleMicButton.addEventListener('click', () => {
            if (window.localStream) {
                const audioTrack = window.localStream.getAudioTracks()[0];
                if (audioTrack) {
                    audioTrack.enabled = !audioTrack.enabled;
                    toggleMicButton.classList.toggle('active', audioTrack.enabled);
                    toggleMicButton.title = audioTrack.enabled ? 'Tắt Mic' : 'Mở Mic';
                }
            }
        });

        toggleCameraButton.addEventListener('click', () => {
            if (window.localStream) {
                const videoTrack = window.localStream.getVideoTracks()[0];
                if (videoTrack) {
                    videoTrack.enabled = !videoTrack.enabled;
                    toggleCameraButton.classList.toggle('active', videoTrack.enabled);
                    toggleCameraButton.title = videoTrack.enabled ? 'Tắt Camera' : 'Mở Camera';
                }
            }
        });

        /**
         * Cập nhật trạng thái các nút điều khiển cuộc gọi
         * @param {boolean} isInCall - Có đang trong cuộc gọi không.
         * @param {boolean} isVideo - Có phải video call không.
         */
        function updateCallButtons(isInCall, isVideo) {
            if (isInCall) {
                toggleMicButton.classList.remove('hidden');
                // Nút camera chỉ hiện nếu là video call
                toggleCameraButton.classList.toggle('hidden', !isVideo); 
                
                // Đảm bảo trạng thái mặc định
                if (window.localStream) {
                     const audioTrack = window.localStream.getAudioTracks()[0];
                     const videoTrack = window.localStream.getVideoTracks()[0];
                     toggleMicButton.classList.toggle('active', audioTrack?.enabled || false);
                     toggleCameraButton.classList.toggle('active', videoTrack?.enabled || false);
                }
            } else {
                toggleMicButton.classList.add('hidden');
                toggleCameraButton.classList.add('hidden');
            }
        }


        // --- XỬ LÝ SOCKET.IO SIGNALING ---
        
        // 1. Nhận Offer (Người khác gọi mình)
        window.socket.on('webrtcSignal', async (data) => {
            if (data.type === 'offer' && data.targetId === window.myUserId) {
                if (window.peerConnection) {
                    // Từ chối nếu đang trong cuộc gọi khác
                    window.socket.emit('webrtcSignal', { type: 'reject', targetId: data.senderId });
                    return;
                }
                
                window.callTargetId = data.senderId;
                window.isVideoCall = data.isVideoCall;
                const senderUsername = window.allUsersCache[data.senderId]?.username || 'Người lạ';
                
                callStatus.textContent = `Cuộc gọi ${data.isVideoCall ? 'Video' : 'Voice'} đến từ ${senderUsername}`;
                
                // 1. Khởi tạo Stream và PC trước khi set remote description
                try {
                    await initLocalStream(data.isVideoCall);
                    const pc = createPeerConnection(data.isVideoCall);
                    await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
                    
                    answerButton.classList.remove('hidden'); // Hiển thị nút trả lời
                    callModal.classList.remove('hidden');
                    
                } catch (e) {
                    console.error('Lỗi khi nhận Offer:', e);
                    window.socket.emit('webrtcSignal', { type: 'reject', targetId: data.senderId });
                    window.hangupCall(); // Tắt stream và reset
                }
            } 
            
            // 2. Nhận Answer (Mình đã gọi và đối phương trả lời)
            else if (data.type === 'answer' && window.peerConnection && data.targetId === window.myUserId) {
                console.log('Nhận Answer, thiết lập Remote Description.');
                await window.peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
                // Kết nối thành công, UI sẽ được cập nhật trong pc.ontrack
            } 
            
            // 3. Nhận ICE Candidate
            else if (data.type === 'iceCandidate' && window.peerConnection && data.targetId === window.myUserId) {
                try {
                    await window.peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
                } catch (e) {
                    console.error('Lỗi khi thêm ICE Candidate:', e);
                }
            }
            
            // 4. Nhận Hangup (Đối phương ngắt máy)
            else if (data.type === 'hangup' && data.targetId === window.myUserId) {
                const senderUsername = window.allUsersCache[data.senderId]?.username || 'Người lạ';
                alert(`${senderUsername} đã kết thúc cuộc gọi.`);
                window.hangupCall();
            }
        });
        
    } // end if chat.html
}); // end DOMContentLoaded