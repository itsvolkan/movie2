// Connect to Socket.io server
const socket = io(window.location.origin);

// DOM Elements
const moviePlayer = document.getElementById('movie-player');
const videoContainer = document.getElementById('video-container');
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
let currentVideoType = 'direct'; // 'direct', 'youtube', 'vimeo', etc.
let currentVideoId = null;
let youtubePlayer = null;
let vimeoPlayer = null;

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
    
    // Load YouTube API
    loadYouTubeAPI();
    // Load Vimeo API
    loadVimeoAPI();
});

socket.on('room-joined', ({ roomId: joinedRoomId }) => {
    roomId = joinedRoomId;
    roomIdDisplay.value = roomId;
    joinCreateModal.classList.remove('active');
    initializeMediaDevices();
    
    // Load YouTube API
    loadYouTubeAPI();
    // Load Vimeo API
    loadVimeoAPI();
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

socket.on('video-state-change', ({ isPlaying, currentTime, videoType }) => {
    if (videoType !== currentVideoType) return;
    
    if (currentVideoType === 'direct') {
        if (isPlaying) {
            moviePlayer.currentTime = currentTime;
            moviePlayer.play();
        } else {
            moviePlayer.currentTime = currentTime;
            moviePlayer.pause();
        }
    } else if (currentVideoType === 'youtube' && youtubePlayer) {
        if (isPlaying) {
            youtubePlayer.seekTo(currentTime);
            youtubePlayer.playVideo();
        } else {
            youtubePlayer.seekTo(currentTime);
            youtubePlayer.pauseVideo();
        }
    } else if (currentVideoType === 'vimeo' && vimeoPlayer) {
        if (isPlaying) {
            vimeoPlayer.setCurrentTime(currentTime).then(() => {
                vimeoPlayer.play();
            });
        } else {
            vimeoPlayer.setCurrentTime(currentTime).then(() => {
                vimeoPlayer.pause();
            });
        }
    }
});

socket.on('video-source-change', ({ type, source, videoType, videoId }) => {
    currentVideoType = videoType;
    currentVideoId = videoId;
    
    if (videoType === 'direct') {
        showDirectPlayer();
        loadVideoFromUrl(source);
    } else if (videoType === 'youtube') {
        showYouTubePlayer();
        if (youtubePlayer) {
            youtubePlayer.loadVideoById(videoId);
        } else {
            // Will be loaded when the API is ready
            createYouTubePlayer(videoId);
        }
    } else if (videoType === 'vimeo') {
        showVimeoPlayer();
        if (vimeoPlayer) {
            loadVimeoVideo(videoId);
        } else {
            // Will be loaded when the API is ready
            createVimeoPlayer(videoId);
        }
    }
});

// Video playback control for direct videos
moviePlayer.addEventListener('play', () => {
    if (roomId && currentVideoType === 'direct') {
        socket.emit('video-state-change', {
            roomId,
            isPlaying: true,
            currentTime: moviePlayer.currentTime,
            videoType: 'direct'
        });
    }
});

moviePlayer.addEventListener('pause', () => {
    if (roomId && currentVideoType === 'direct') {
        socket.emit('video-state-change', {
            roomId,
            isPlaying: false,
            currentTime: moviePlayer.currentTime,
            videoType: 'direct'
        });
    }
});

moviePlayer.addEventListener('seeked', () => {
    if (roomId && currentVideoType === 'direct') {
        socket.emit('video-state-change', {
            roomId,
            isPlaying: !moviePlayer.paused,
            currentTime: moviePlayer.currentTime,
            videoType: 'direct'
        });
    }
});

// Load video from file
fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        currentVideoType = 'direct';
        showDirectPlayer();
        const fileURL = URL.createObjectURL(file);
        moviePlayer.src = fileURL;
        videoUrl.value = '';
        
        if (roomId) {
            socket.emit('video-source-change', {
                roomId,
                type: 'file',
                source: 'local-file', // Cannot share actual file, just notify others
                videoType: 'direct',
                videoId: null
            });
        }
    }
});

// Load video from URL
loadUrlBtn.addEventListener('click', () => {
    const url = videoUrl.value.trim();
    if (url) {
        processVideoUrl(url);
    }
});

function processVideoUrl(url) {
    // Check if it's a YouTube URL
    const youtubeMatch = url.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/);
    if (youtubeMatch && youtubeMatch[1]) {
        const videoId = youtubeMatch[1];
        currentVideoType = 'youtube';
        currentVideoId = videoId;
        showYouTubePlayer();
        
        if (youtubePlayer) {
            youtubePlayer.loadVideoById(videoId);
        } else {
            createYouTubePlayer(videoId);
        }
        
        if (roomId) {
            socket.emit('video-source-change', {
                roomId,
                type: 'url',
                source: url,
                videoType: 'youtube',
                videoId: videoId
            });
        }
        return;
    }
    
    // Check if it's a Vimeo URL
    const vimeoMatch = url.match(/(?:vimeo\.com\/(?:channels\/(?:\w+\/)?|groups\/(?:[^\/]*)\/videos\/|album\/(?:\d+)\/video\/|video\/|)(\d+)(?:$|\/|\?))/);
    if (vimeoMatch && vimeoMatch[1]) {
        const videoId = vimeoMatch[1];
        currentVideoType = 'vimeo';
        currentVideoId = videoId;
        showVimeoPlayer();
        
        if (vimeoPlayer) {
            loadVimeoVideo(videoId);
        } else {
            createVimeoPlayer(videoId);
        }
        
        if (roomId) {
            socket.emit('video-source-change', {
                roomId,
                type: 'url',
                source: url,
                videoType: 'vimeo',
                videoId: videoId
            });
        }
        return;
    }
    
    // If it's not YouTube or Vimeo, try to load as direct URL
    currentVideoType = 'direct';
    showDirectPlayer();
    loadVideoFromUrl(url);
    
    if (roomId) {
        socket.emit('video-source-change', {
            roomId,
            type: 'url',
            source: url,
            videoType: 'direct',
            videoId: null
        });
    }
}

function loadVideoFromUrl(url) {
    moviePlayer.src = url;
    videoUrl.value = url;
}

// Player switching functions
function showDirectPlayer() {
    // Remove any existing iframe players
    const existingYoutubeDiv = document.getElementById('youtube-player');
    if (existingYoutubeDiv) {
        existingYoutubeDiv.style.display = 'none';
    }
    
    const existingVimeoDiv = document.getElementById('vimeo-player');
    if (existingVimeoDiv) {
        existingVimeoDiv.style.display = 'none';
    }
    
    // Show direct player
    moviePlayer.style.display = 'block';
}

function showYouTubePlayer() {
    // Hide direct player
    moviePlayer.style.display = 'none';
    
    // Hide Vimeo player if exists
    const existingVimeoDiv = document.getElementById('vimeo-player');
    if (existingVimeoDiv) {
        existingVimeoDiv.style.display = 'none';
    }
    
    // Show YouTube player
    let youtubeDiv = document.getElementById('youtube-player');
    if (!youtubeDiv) {
        youtubeDiv = document.createElement('div');
        youtubeDiv.id = 'youtube-player';
        videoContainer.insertBefore(youtubeDiv, videoContainer.firstChild);
    }
    youtubeDiv.style.display = 'block';
}

function showVimeoPlayer() {
    // Hide direct player
    moviePlayer.style.display = 'none';
    
    // Hide YouTube player if exists
    const existingYoutubeDiv = document.getElementById('youtube-player');
    if (existingYoutubeDiv) {
        existingYoutubeDiv.style.display = 'none';
    }
    
    // Show Vimeo player
    let vimeoDiv = document.getElementById('vimeo-player');
    if (!vimeoDiv) {
        vimeoDiv = document.createElement('div');
        vimeoDiv.id = 'vimeo-player';
        videoContainer.insertBefore(vimeoDiv, videoContainer.firstChild);
    }
    vimeoDiv.style.display = 'block';
}

// YouTube API integration
function loadYouTubeAPI() {
    if (window.YT) return; // API already loaded
    
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    const firstScriptTag = document.getElementsByTagName('script')[0];
    firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
    
    window.onYouTubeIframeAPIReady = function() {
        if (currentVideoType === 'youtube' && currentVideoId) {
            createYouTubePlayer(currentVideoId);
        }
    };
}

function createYouTubePlayer(videoId) {
    if (!window.YT || !window.YT.Player) {
        // If API not ready, store video ID and wait
        currentVideoId = videoId;
        return;
    }
    
    let youtubeDiv = document.getElementById('youtube-player');
    if (!youtubeDiv) {
        youtubeDiv = document.createElement('div');
        youtubeDiv.id = 'youtube-player';
        videoContainer.insertBefore(youtubeDiv, videoContainer.firstChild);
    }
    
    youtubePlayer = new YT.Player('youtube-player', {
        height: '100%',
        width: '100%',
        videoId: videoId,
        playerVars: {
            'playsinline': 1,
            'enablejsapi': 1,
            'origin': window.location.origin
        },
        events: {
            'onReady': onYouTubePlayerReady,
            'onStateChange': onYouTubePlayerStateChange
        }
    });
}

function onYouTubePlayerReady(event) {
    // Player is ready
}

function onYouTubePlayerStateChange(event) {
    if (!roomId || currentVideoType !== 'youtube') return;
    
    if (event.data === YT.PlayerState.PLAYING) {
        socket.emit('video-state-change', {
            roomId,
            isPlaying: true,
            currentTime: youtubePlayer.getCurrentTime(),
            videoType: 'youtube'
        });
    } else if (event.data === YT.PlayerState.PAUSED) {
        socket.emit('video-state-change', {
            roomId,
            isPlaying: false,
            currentTime: youtubePlayer.getCurrentTime(),
            videoType: 'youtube'
        });
    }
}

// Vimeo API integration
function loadVimeoAPI() {
    if (window.Vimeo) return; // API already loaded
    
    const tag = document.createElement('script');
    tag.src = 'https://player.vimeo.com/api/player.js';
    const firstScriptTag = document.getElementsByTagName('script')[0];
    firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
    
    // Check if API is loaded
    const checkVimeoAPI = setInterval(() => {
        if (window.Vimeo) {
            clearInterval(checkVimeoAPI);
            if (currentVideoType === 'vimeo' && currentVideoId) {
                createVimeoPlayer(currentVideoId);
            }
        }
    }, 500);
}

function createVimeoPlayer(videoId) {
    if (!window.Vimeo) {
        // If API not ready, store video ID and wait
        currentVideoId = videoId;
        return;
    }
    
    let vimeoDiv = document.getElementById('vimeo-player');
    if (!vimeoDiv) {
        vimeoDiv = document.createElement('div');
        vimeoDiv.id = 'vimeo-player';
        videoContainer.insertBefore(vimeoDiv, videoContainer.firstChild);
    }
    
    // Clear any existing iframe
    vimeoDiv.innerHTML = '';
    
    vimeoPlayer = new Vimeo.Player(vimeoDiv, {
        id: videoId,
        width: '100%',
        height: '100%'
    });
    
    // Add event listeners
    vimeoPlayer.on('play', function() {
        if (roomId && currentVideoType === 'vimeo') {
            vimeoPlayer.getCurrentTime().then(function(seconds) {
                socket.emit('video-state-change', {
                    roomId,
                    isPlaying: true,
                    currentTime: seconds,
                    videoType: 'vimeo'
                });
            });
        }
    });
    
    vimeoPlayer.on('pause', function() {
        if (roomId && currentVideoType === 'vimeo') {
            vimeoPlayer.getCurrentTime().then(function(seconds) {
                socket.emit('video-state-change', {
                    roomId,
                    isPlaying: false,
                    currentTime: seconds,
                    videoType: 'vimeo'
                });
            });
        }
    });
    
    vimeoPlayer.on('seeked', function() {
        if (roomId && currentVideoType === 'vimeo') {
            vimeoPlayer.getPaused().then(function(paused) {
                vimeoPlayer.getCurrentTime().then(function(seconds) {
                    socket.emit('video-state-change', {
                        roomId,
                        isPlaying: !paused,
                        currentTime: seconds,
                        videoType: 'vimeo'
                    });
                });
            });
        }
    });
}

function loadVimeoVideo(videoId) {
    if (vimeoPlayer) {
        vimeoPlayer.loadVideo(videoId);
    } else {
        createVimeoPlayer(videoId);
    }
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
