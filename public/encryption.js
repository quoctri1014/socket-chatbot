// Tên file: public/encryption.js
// Sử dụng Web Crypto API cho E2EE

class EncryptionService {
    constructor() {
        this.key = null;
        this.algorithm = { name: 'AES-GCM', length: 256 };
    }

    /**
     * Tạo hoặc lấy key từ localStorage
     */
    async initialize() {
        try {
            let keyString = localStorage.getItem('encryptionKey');
            
            if (!keyString) {
                // Tạo key mới
                this.key = await crypto.subtle.generateKey(
                    this.algorithm,
                    true,
                    ['encrypt', 'decrypt']
                );
                
                // Export key để lưu
                const exported = await crypto.subtle.exportKey('jwk', this.key);
                localStorage.setItem('encryptionKey', JSON.stringify(exported));
                console.log('✅ Đã tạo key mã hóa mới');
            } else {
                // Import key từ localStorage
                const keyData = JSON.parse(keyString);
                this.key = await crypto.subtle.importKey(
                    'jwk',
                    keyData,
                    this.algorithm,
                    true,
                    ['encrypt', 'decrypt']
                );
                console.log('✅ Đã tải key mã hóa từ localStorage');
            }
            return true;
        } catch (error) {
            console.error('Lỗi khởi tạo encryption:', error);
            return false;
        }
    }

    /**
     * Mã hóa tin nhắn
     */
    async encryptMessage(message) {
        try {
            if (!this.key) {
                const initialized = await this.initialize();
                if (!initialized) throw new Error('Không thể khởi tạo encryption');
            }

            const encoder = new TextEncoder();
            const data = encoder.encode(message);
            
            const iv = crypto.getRandomValues(new Uint8Array(12));
            
            const encrypted = await crypto.subtle.encrypt(
                { name: 'AES-GCM', iv: iv },
                this.key,
                data
            );

            // Kết hợp iv và dữ liệu mã hóa
            const combined = new Uint8Array(iv.length + encrypted.byteLength);
            combined.set(iv);
            combined.set(new Uint8Array(encrypted), iv.length);

            return btoa(String.fromCharCode(...combined));
        } catch (error) {
            console.error('Lỗi mã hóa:', error);
            throw error;
        }
    }

    /**
     * Giải mã tin nhắn
     */
    async decryptMessage(encryptedData) {
        try {
            if (!this.key) {
                const initialized = await this.initialize();
                if (!initialized) throw new Error('Không thể khởi tạo encryption');
            }

            const combined = new Uint8Array(
                atob(encryptedData).split('').map(char => char.charCodeAt(0))
            );

            const iv = combined.slice(0, 12);
            const data = combined.slice(12);

            const decrypted = await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv: iv },
                this.key,
                data
            );

            const decoder = new TextDecoder();
            return decoder.decode(decrypted);
        } catch (error) {
            console.error('Lỗi giải mã:', error);
            throw error;
        }
    }

    /**
     * Kiểm tra xem chuỗi có phải là dữ liệu mã hóa không
     */
    isEncrypted(data) {
        try {
            // Kiểm tra xem có phải base64 không
            if (!data || typeof data !== 'string') return false;
            
            // Base64 thường kết thúc bằng = và chỉ chứa ký tự base64
            if (!data.match(/^[A-Za-z0-9+/]*={0,2}$/)) return false;
            
            const combined = new Uint8Array(
                atob(data).split('').map(char => char.charCodeAt(0))
            );
            
            // Dữ liệu mã hóa AES-GCM cần có ít nhất 12 byte IV + 1 byte data
            return combined.length >= 13;
        } catch {
            return false;
        }
    }

    /**
     * Xóa key mã hóa (để reset)
     */
    clearKey() {
        localStorage.removeItem('encryptionKey');
        this.key = null;
        console.log('✅ Đã xóa key mã hóa');
    }
}

// Khởi tạo service encryption toàn cục
window.encryptionService = new EncryptionService();