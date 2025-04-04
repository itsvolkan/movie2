// Connect to Socket.io server
const socket = io(window.location.origin);

// DOM Elements
const moviePlayer = document.getElementById('movie-player');
const fileInput = document.getElementById('file-input');
const videoUrl = document.getElementById('video-url');
const loadUrlBtn = document.getElementById('load-url');
const roomIdDisplay = document.getElementById('room-id');
const copyLinkBtn = document.getElementById('copy-link');
const messagesContainer = document.getElementById('messages');
const messageInput = document.getElementById('message-input');
const sendMessageBtn = document.getElementById('send-message');
const toggleVideoBtn = document.getElementById('toggle-video');
const toggleAudioBtn = document.getElementById('toggle-audio');
const createRoomBtn = document.getElementById('create-room');
const joinRoomBtn = document.getElementById('join-room');
const usernameCreateInput = document.getElementById('username-create');
const usernameJoinInput = document.getElementById('username-join');
const roomIdJoinInput = document.getElementById('room-id-join');
const joinCreateModal = document.getElementById('join-create-modal');
const videoParticipants = document.getElementById('video-participants');
const localVideo = document.getElementById('local-video');

// Global variables
let roomId = null;
let username = null;
let localStream = null;
let peers = {};
let isVideoEnabled = true;
let isAudioEnabled = true;

// Initialize media devices
async function initializeMediaDevices() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideo.srcObject = localStream;
    } catch (error) {
        console.error('Error accessing media devices:', error);
        alert('Could not access camera or microphone');
    }
}

// Create a new room
createRoomBtn.addEventListener('click', () => {
    username = usernameCreateInput.value.trim();
    if (!username) {
        alert('Please enter a username');
        return;
    }
    
    socket.emit('create-room', { username });
});

// Join existing room
joinRoomBtn.addEventListener('click', () => {
    const roomIdToJoin = roomIdJoinInput.value.trim();
    username = usernameJoinInput.value.trim();
    
    if (!roomIdToJoin || !username) {
        alert('Please enter both room ID and username');
        return;
    }
    
    socket.emit('join-room', { roomId: roomIdToJoin, username });
});

// Socket event handlers
socket.on('room-created', ({ roomId: newRoomId }) => {
    roomId = newRoomId;
    roomIdDisplay.value = roomId;
    joinCreateModal.classList.remove('active');
    initializeMediaDevices();
});

socket.on('room-joined', ({ roomId: joinedRoomId }) => {
    roomId = joinedRoomId;
    roomIdDisplay.value = roomId;
    joinCreateModal.classList.remove('active');
    initializeMediaDevices();
});

socket.on('room-join-error', ({ message }) => {
    alert(message);
});

socket.on('user-connected', ({ userId, username: newUsername }) => {
    addMessage(`${newUsername} has joined the room`, 'system');
    
    // Create a new peer connection for the new user
    const peer = new SimplePeer({
        initiator: true,
        stream: localStream
    });
    
    peer.on('signal', signal => {
        socket.emit('signal', { userId, signal });
    });
    
    peer.on('stream', stream => {
        // Add remote video stream to the UI
        addVideoStream(userId, stream, newUsername);
    });
    
    peers[userId] = peer;
});

socket.on('user-disconnected', ({ userId, username: disconnectedUsername }) => {
    addMessage(`${disconnectedUsername} has left the room`, 'system');
    
    if (peers[userId]) {
        peers[userId].destroy();
        delete peers[userId];
    }
    
    // Remove video element
    const videoElement = document.getElementById(`video-${userId}`);
    if (videoElement) {
        videoElement.parentElement.remove();
    }
});

socket.on('receive-signal', ({ userId, signal }) => {
    if (peers[userId]) {
        peers[userId].signal(signal);
    } else {
        // This is a new peer initiating a connection
        const peer = new SimplePeer({
            initiator: false,
            stream: localStream
        });
        
        peer.on('signal', signal => {
            socket.emit('signal', { userId, signal });
        });
        
        peer.on('stream', stream => {
            // Add remote video stream to the UI
            socket.emit('get-username', { userId });
            socket.once('username-response', ({ username: remoteUsername }) => {
                addVideoStream(userId, stream, remoteUsername);
            });
        });
        
        peer.signal(signal);
        peers[userId] = peer;
    }
});

socket.on('chat-message', ({ username: messageUsername, message }) => {
    addMessage(message, 'other', messageUsername);
});

socket.on('video-state-change', ({ isPlaying, currentTime }) => {
    if (isPlaying) {
        moviePlayer.currentTime = currentTime;
        moviePlayer.play();
    } else {
        moviePlayer.currentTime = currentTime;
        moviePlayer.pause();
    }
});

socket.on('video-source-change', ({ type, source }) => {
    if (type === 'url') {
        loadVideoFromUrl(source);
    }
});

// Video playback control
moviePlayer.addEventListener('play', () => {
    if (roomId) {
        socket.emit('video-state-change', {
            roomId,
            isPlaying: true,
            currentTime: moviePlayer.currentTime
        });
    }
});

moviePlayer.addEventListener('pause', () => {
    if (roomId) {
        socket.emit('video-state-change', {
            roomId,
            isPlaying: false,
            currentTime: moviePlayer.currentTime
        });
    }
});

moviePlayer.addEventListener('seeked', () => {
    if (roomId) {
        socket.emit('video-state-change', {
            roomId,
            isPlaying: !moviePlayer.paused,
            currentTime: moviePlayer.currentTime
        });
    }
});

// Load video from file
fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        const fileURL = URL.createObjectURL(file);
        moviePlayer.src = fileURL;
        videoUrl.value = '';
    }
});

// Load video from URL
loadUrlBtn.addEventListener('click', () => {
    const url = videoUrl.value.trim();
    if (url) {
        loadVideoFromUrl(url);
        
        if (roomId) {
            socket.emit('video-source-change', {
                roomId,
                type: 'url',
                source: url
            });
        }
    }
});

function loadVideoFromUrl(url) {
    moviePlayer.src = url;
    videoUrl.value = url;
}

// Chat functionality
sendMessageBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        sendMessage();
    }
});

function sendMessage() {
    const message = messageInput.value.trim();
    if (message && roomId) {
        socket.emit('chat-message', { roomId, message });
        addMessage(message, 'own');
        messageInput.value = '';
    }
}

function addMessage(message, type, sender = null) {
    const messageElement = document.createElement('div');
    messageElement.classList.add('message', type);
    
    if (type !== 'system') {
        const usernameElement = document.createElement('div');
        usernameElement.classList.add('username');
        usernameElement.textContent = type === 'own' ? username : sender;
        messageElement.appendChild(usernameElement);
    }
    
    const textElement = document.createElement('div');
    textElement.textContent = message;
    messageElement.appendChild(textElement);
    
    messagesContainer.appendChild(messageElement);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Video chat controls
toggleVideoBtn.addEventListener('click', () => {
    isVideoEnabled = !isVideoEnabled;
    localStream.getVideoTracks().forEach(track => {
        track.enabled = isVideoEnabled;
    });
    toggleVideoBtn.textContent = isVideoEnabled ? 'Toggle Video' : 'Enable Video';
});

toggleAudioBtn.addEventListener('click', () => {
    isAudioEnabled = !isAudioEnabled;
    localStream.getAudioTracks().forEach(track => {
        track.enabled = isAudioEnabled;
    });
    toggleAudioBtn.textContent = isAudioEnabled ? 'Toggle Audio' : 'Enable Audio';
});

// Copy room link
copyLinkBtn.addEventListener('click', () => {
    const roomLink = `${window.location.href}?room=${roomId}`;
    navigator.clipboard.writeText(roomLink)
        .then(() => {
            alert('Room link copied to clipboard!');
        })
        .catch(err => {
            console.error('Could not copy text: ', err);
        });
});

// Helper function to add video stream to UI
function addVideoStream(userId, stream, streamUsername) {
    const videoContainer = document.createElement('div');
    videoContainer.classList.add('video-participant');
    
    const video = document.createElement('video');
    video.srcObject = stream;
    video.id = `video-${userId}`;
    video.autoplay = true;
    
    const usernameLabel = document.createElement('div');
    usernameLabel.textContent = streamUsername;
    usernameLabel.classList.add('video-username');
    
    videoContainer.appendChild(video);
    videoContainer.appendChild(usernameLabel);
    videoParticipants.appendChild(videoContainer);
}

// Check URL for room ID (for direct joining via shared link)
window.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const roomFromUrl = urlParams.get('room');
    
    if (roomFromUrl) {
        roomIdJoinInput.value = roomFromUrl;
    }
});