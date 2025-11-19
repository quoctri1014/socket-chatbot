// Tên file: public/webrtc.js (HOÀN CHỈNH)

document.addEventListener('DOMContentLoaded', () => {
    const path = window.location.pathname;

    if (path.endsWith('/chat.html')) {
        // --- CẤU HÌNH & BIẾN TOÀN CỤC ---
        
        // Cấu hình ICE Servers
        const iceConfig = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
            ]
        };

        // Biến toàn cục WebRTC
        window.peerConnection = null;
        window.localStream = null;
        window.callTargetId = null;
        window.isVideoCall = false;
        window.isCaller = false;

        // DOM Elements
        const callModal = document.getElementById('call-modal');
        const callStatus = document.getElementById('call-status');
        const localVideo = document.getElementById('local-video');
        const remoteVideo = document.getElementById('remote-video');
        const hangupButton = document.getElementById('hangup-button');
        const answerButton = document.getElementById('answer-call-button');
        const toggleMicButton = document.getElementById('toggle-mic-button');
        const toggleCameraButton = document.getElementById('toggle-camera-button');
        const phoneCallButton = document.getElementById('call-button');
        const videoCallButton = document.getElementById('video-call-button');

        // --- CÁC HÀM XỬ LÝ MEDIA VÀ PC ---

        /**
         * Khởi tạo stream (micro/camera)
         */
        async function initLocalStream(withVideo = true) {
            try {
                window.localStream = await navigator.mediaDevices.getUserMedia({
                    video: withVideo,
                    audio: true,
                });
                localVideo.srcObject = window.localStream;
                window.isVideoCall = withVideo;
                
                updateCallButtons(true, withVideo);

            } catch (err) {
                console.error('Lỗi khi lấy media:', err);
                alert('Không thể truy cập Microphone hoặc Camera. Vui lòng kiểm tra quyền.');
                throw err;
            }
        }

        /**
         * Tạo RTCPeerConnection
         */
        function createPeerConnection() {
            if (window.peerConnection) return window.peerConnection;

            const pc = new RTCPeerConnection(iceConfig);

            // Gửi ICE Candidates
            pc.onicecandidate = (event) => {
                if (event.candidate) {
                    window.socket.emit('webrtcSignal', {
                        type: 'iceCandidate',
                        targetId: window.callTargetId,
                        candidate: event.candidate,
                    });
                }
            };

            // Nhận remote stream
            pc.ontrack = (event) => {
                if (remoteVideo.srcObject !== event.streams[0]) {
                    remoteVideo.srcObject = event.streams[0];
                    console.log('Remote stream received');
                    
                    callStatus.textContent = window.isVideoCall ? 'Đã kết nối (Video Call)' : 'Đã kết nối (Voice Call)';
                    answerButton.classList.add('hidden');
                }
            };
            
            // Thêm local stream
            if (window.localStream) {
                window.localStream.getTracks().forEach(track => {
                    pc.addTrack(track, window.localStream);
                });
            }

            // Xử lý trạng thái kết nối
            pc.oniceconnectionstatechange = () => {
                console.log(`ICE state: ${pc.iceConnectionState}`);
                if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
                    hangupCall();
                }
            };

            window.peerConnection = pc;
            return pc;
        }
        
        // --- LOGIC CUỘC GỌI ---

        /**
         * Bắt đầu cuộc gọi
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
            window.isCaller = true;

            try {
                await initLocalStream(isVideo);
                const pc = createPeerConnection();

                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);

                window.socket.emit('webrtcSignal', {
                    type: 'offer',
                    targetId: targetId,
                    offer: pc.localDescription,
                    isVideoCall: isVideo,
                });
                
                callStatus.textContent = `Đang chờ ${targetUsername} chấp nhận cuộc gọi ${isVideo ? 'Video' : 'Voice'}...`;
                answerButton.classList.add('hidden');
                callModal.classList.remove('hidden');

            } catch (err) {
                console.error('Lỗi khi bắt đầu cuộc gọi:', err);
                hangupCall();
            }
        };

        /**
         * Trả lời cuộc gọi
         */
        async function answerCall() {
            if (!window.peerConnection) return;
            
            callStatus.textContent = window.isVideoCall ? 'Đang kết nối Video...' : 'Đang kết nối Voice...';
            answerButton.classList.add('hidden');
            
            try {
                const answer = await window.peerConnection.createAnswer();
                await window.peerConnection.setLocalDescription(answer);

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

            // Gửi tín hiệu hangup
            if (window.callTargetId) {
                window.socket.emit('webrtcSignal', {
                    type: 'hangup',
                    targetId: window.callTargetId,
                });
            }

            window.callTargetId = null;
            localVideo.srcObject = null;
            remoteVideo.srcObject = null;
            callModal.classList.add('hidden');
            
            updateCallButtons(false, false);
            console.log('Cuộc gọi đã kết thúc.');
        };

        // --- XỬ LÝ NÚT BẤM ---

        phoneCallButton.addEventListener('click', () => window.startCall(false));
        videoCallButton.addEventListener('click', () => window.startCall(true));
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
            if (window.localStream && window.isVideoCall) {
                const videoTrack = window.localStream.getVideoTracks()[0];
                if (videoTrack) {
                    videoTrack.enabled = !videoTrack.enabled;
                    toggleCameraButton.classList.toggle('active', videoTrack.enabled);
                    toggleCameraButton.title = videoTrack.enabled ? 'Tắt Camera' : 'Mở Camera';
                }
            }
        });

        /**
         * Cập nhật trạng thái nút điều khiển
         */
        function updateCallButtons(isInCall, isVideo) {
            if (isInCall) {
                toggleMicButton.classList.remove('hidden');
                toggleCameraButton.classList.toggle('hidden', !isVideo);
                
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
        
        window.socket.on('webrtcSignal', async (data) => {
            // 1. Nhận Offer
            if (data.type === 'offer' && data.targetId === window.myUserId) {
                if (window.peerConnection) {
                    window.socket.emit('webrtcSignal', { type: 'reject', targetId: data.senderId });
                    return;
                }
                
                window.callTargetId = data.senderId;
                window.isVideoCall = data.isVideoCall;
                window.isCaller = false;
                const senderUsername = window.allUsersCache[data.senderId]?.username || 'Người lạ';
                
                callStatus.textContent = `Cuộc gọi ${data.isVideoCall ? 'Video' : 'Voice'} đến từ ${senderUsername}`;
                
                try {
                    await initLocalStream(data.isVideoCall);
                    const pc = createPeerConnection();
                    await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
                    
                    answerButton.classList.remove('hidden');
                    callModal.classList.remove('hidden');
                    
                } catch (e) {
                    console.error('Lỗi khi nhận Offer:', e);
                    window.socket.emit('webrtcSignal', { type: 'reject', targetId: data.senderId });
                    window.hangupCall();
                }
            } 
            
            // 2. Nhận Answer
            else if (data.type === 'answer' && window.peerConnection && data.targetId === window.myUserId) {
                console.log('Nhận Answer, thiết lập Remote Description.');
                await window.peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
            } 
            
            // 3. Nhận ICE Candidate
            else if (data.type === 'iceCandidate' && window.peerConnection && data.targetId === window.myUserId) {
                try {
                    await window.peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
                } catch (e) {
                    console.error('Lỗi khi thêm ICE Candidate:', e);
                }
            }
            
            // 4. Nhận Hangup
            else if (data.type === 'hangup' && data.targetId === window.myUserId) {
                const senderUsername = window.allUsersCache[data.senderId]?.username || 'Người lạ';
                alert(`${senderUsername} đã kết thúc cuộc gọi.`);
                window.hangupCall();
            }
            
            // 5. Nhận Reject
            else if (data.type === 'reject' && data.targetId === window.myUserId) {
                alert('Cuộc gọi đã bị từ chối.');
                window.hangupCall();
            }
        });
        
    } // end if chat.html
});