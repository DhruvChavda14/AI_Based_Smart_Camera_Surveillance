import { io } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5050';

class SocketService {
  constructor() {
    this.socket = null;
  }

  connect() {
    if (!this.socket) {
      this.socket = io(SOCKET_URL, {
        autoConnect: true,
        reconnection: true,
      });

      this.socket.on('connect', () => {
        console.log('Connected to WebSocket server');
      });

      this.socket.on('disconnect', () => {
        console.log('Disconnected from WebSocket server');
      });
    }
    return this.socket;
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  // Listen to new AI model alerts broadcasted in real-time
  onModelAlert(callback) {
    if (!this.socket) return;
    this.socket.on('new_model_alert', callback);
  }

  offModelAlert(callback) {
    if (!this.socket) return;
    this.socket.off('new_model_alert', callback);
  }
}

export const socketService = new SocketService();
export default socketService;
