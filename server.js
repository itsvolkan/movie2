const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Store room data
const rooms = {};
const users = {};

// Socket.io connection handler
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    
    // Create a new room
    socket.on('create-room', ({ username }) => {
        const roomId = uuidv4().substring(0, 8);
        
        rooms[roomId] = {
            users: {},
            videoState: {
                source: null,
                isPlaying: false,
                currentTime: 0
            }
        };
        
        // Add user to room
        rooms[roomId].users[socket.id] = { username };
        users[socket.id] = { roomId, username };
        
        // Join socket.io room
        socket.join(roomId);
        
        // Send room ID back to client
        socket.emit('room-created', { roomId });
        
        console.log(`Room created: ${roomId} by ${username}`);
    });
    
    // Join existing room
    socket.on('join-room', ({ roomId, username }) => {
        if (!rooms[roomId]) {
            socket.emit('room-join-error', { message: 'Room does not exist' });
            return;
        }
        
        // Add user to room
        rooms[roomId].users[socket.id] = { username };
        users[socket.id] = { roomId, username };
        
        // Join socket.io room
        socket.join(roomId);
        
        // Send room ID back to client
        socket.emit('room-joined', { roomId });
        
        // Notify other users in the room
        socket.to(roomId).emit('user-connected', { userId: socket.id, username });
        
        // Send current video state
        if (rooms[roomId].videoState.source) {
            socket.emit('video-source-change', {
                type: 'url',
                source: rooms[roomId].videoState.source
            });
            
            socket.emit('video-state-change', {
                isPlaying: rooms[roomId].videoState.isPlaying,
                currentTime: rooms[roomId].videoState.currentTime
            });
        }
        
        console.log(`User ${username} joined room: ${roomId}`);
    });
    
    // WebRTC signaling
    socket.on('signal', ({ userId, signal }) => {
        io.to(userId).emit('receive-signal', { userId: socket.id, signal });
    });
    
    // Get username by user ID
    socket.on('get-username', ({ userId }) => {
        const roomId = users[socket.id]?.roomId;
        if (roomId && rooms[roomId] && rooms[roomId].users[userId]) {
            socket.emit('username-response', { 
                username: rooms[roomId].users[userId].username 
            });
        }
    });
    
    // Chat message
    socket.on('chat-message', ({ roomId, message }) => {
        if (users[socket.id] && rooms[roomId]) {
            socket.to(roomId).emit('chat-message', {
                username: users[socket.id].username,
                message
            });
        }
    });
    
    // Video state change (play/pause/seek)
    socket.on('video-state-change', ({ roomId, isPlaying, currentTime }) => {
        if (rooms[roomId]) {
            rooms[roomId].videoState.isPlaying = isPlaying;
            rooms[roomId].videoState.currentTime = currentTime;
            
            socket.to(roomId).emit('video-state-change', { isPlaying, currentTime });
        }
    });
    
    // Video source change
    socket.on('video-source-change', ({ roomId, type, source }) => {
        if (rooms[roomId]) {
            rooms[roomId].videoState.source = source;
            rooms[roomId].videoState.isPlaying = false;
            rooms[roomId].videoState.currentTime = 0;
            
            socket.to(roomId).emit('video-source-change', { type, source });
        }
    });
    
    // Disconnection
    socket.on('disconnect', () => {
        const userData = users[socket.id];
        if (userData) {
            const { roomId, username } = userData;
            
            // Remove user from room and notify others
            if (rooms[roomId]) {
                delete rooms[roomId].users[socket.id];
                
                // If room is empty, delete it
                if (Object.keys(rooms[roomId].users).length === 0) {
                    delete rooms[roomId];
                    console.log(`Room ${roomId} deleted (empty)`);
                } else {
                    // Notify others that user has left
                    socket.to(roomId).emit('user-disconnected', {
                        userId: socket.id,
                        username
                    });
                }
            }
            
            // Remove user data
            delete users[socket.id];
            console.log(`User disconnected: ${socket.id} (${username})`);
        }
    });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});