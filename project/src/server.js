require('dotenv').config();

const http = require('http');
const { Server: SocketIOServer } = require('socket.io');
const jwt = require('jsonwebtoken');
const app = require('./app');
const db = require('./config/database');
const FileWatcher = require('./services/FileWatcher');
const DocumentQueue = require('./services/DocumentQueue');
const NotificationService = require('./services/NotificationService');
const { applySuperadminBootstrap } = require('./services/superadminBootstrap');

const PORT = process.env.PORT || 3000;
const ENABLE_FILE_WATCHER = process.env.ENABLE_FILE_WATCHER !== 'false';
const FILE_WATCHER_MODE = process.env.FILE_WATCHER_MODE || 'poll';

async function start() {
  try {
    // 1. Verify database
    await db.raw('SELECT 1');
    console.log('[DB] Connected to PostgreSQL');

    // 1b. Sync superadmin from env so the bootstrap toggle is live, not
    // migration-only. Default off: with no SUPERADMIN_BOOTSTRAP_EMAIL
    // set, every is_superadmin grant gets revoked on each boot. Set the
    // env var in .env to grant a specific user (created at ChangeMe123!
    // if missing).
    try {
      await applySuperadminBootstrap(db, process.env.SUPERADMIN_BOOTSTRAP_EMAIL);
    } catch (err) {
      console.error('[SUPERADMIN] Sync skipped:', err.message);
    }

    // 2. Create HTTP server and attach Socket.io
    const server = http.createServer(app);

    const io = new SocketIOServer(server, {
      cors: {
        origin: process.env.CORS_ORIGIN || '*',
        methods: ['GET', 'POST'],
      },
    });

    // 3. WebSocket authentication middleware
    io.use((socket, next) => {
      const token = socket.handshake.auth.token || socket.handshake.query.token;
      if (!token) {
        return next(new Error('Authentication required'));
      }

      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        socket.userId = decoded.id;
        socket.userRole = decoded.role;
        next();
      } catch {
        next(new Error('Invalid token'));
      }
    });

    // 4. WebSocket connection handling
    io.on('connection', (socket) => {
      // Join user-specific room for targeted notifications
      socket.join(`user:${socket.userId}`);
      console.log(`[WS] User ${socket.userId} connected (${socket.userRole})`);

      socket.on('disconnect', () => {
        console.log(`[WS] User ${socket.userId} disconnected`);
      });

      // Allow clients to mark notifications as read in real-time
      socket.on('mark_read', async (notificationId) => {
        try {
          await NotificationService.markRead(notificationId, socket.userId);
          socket.emit('notification_read', { id: notificationId });
        } catch (err) {
          socket.emit('error', { message: err.message });
        }
      });
    });

    // 5. Initialize NotificationService with Socket.io
    NotificationService.init(io);
    console.log('[WS] WebSocket server ready — real-time notifications enabled');

    // 6. Start HTTP server
    server.listen(PORT, () => {
      console.log(`[SERVER] Running on http://localhost:${PORT}`);
      console.log(`[SERVER] Environment: ${process.env.NODE_ENV || 'development'}`);
    });

    // 7. Start file watcher
    if (ENABLE_FILE_WATCHER) {
      try {
        await FileWatcher.start(FILE_WATCHER_MODE);
        console.log(`[FILE WATCHER] Active (${FILE_WATCHER_MODE} mode)`);
      } catch (err) {
        console.warn(`[FILE WATCHER] Failed: ${err.message} — files still processed via upload API`);
      }
    }

    // 8. Log AI status
    console.log(`[AI] Claude API: ${process.env.ANTHROPIC_API_KEY ? 'Configured' : 'Not set (empty extractions)'}`);
    console.log(`[AI] Textract:   ${process.env.AWS_TEXTRACT_REGION || 'Not set (text files only)'}`);

    // 9. Graceful shutdown
    const shutdown = async (signal) => {
      console.log(`\n[SERVER] ${signal} — shutting down...`);
      FileWatcher.stop();
      try { await DocumentQueue.shutdown(); } catch {}
      io.close();
      server.close(async () => {
        await db.destroy();
        console.log('[SERVER] Closed.');
        process.exit(0);
      });
      setTimeout(() => process.exit(1), 10000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

  } catch (err) {
    console.error('[SERVER] Failed to start:', err.message);
    process.exit(1);
  }
}

start();
