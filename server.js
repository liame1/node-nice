const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

// Serve static files from the current directory
app.use(express.static(__dirname));

// Route for the main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Game state
const gameState = {
    players: {},
    ball: {
        x: 400,
        y: 300,
        velocityX: 5,
        velocityY: 5
    },
    paddle1: { y: 250 },
    paddle2: { y: 250 },
    score: { player1: 0, player2: 0 },
    gameRunning: false
};

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);
    
    // Assign player number
    const playerCount = Object.keys(gameState.players).length;
    let playerNumber;
    
    if (playerCount === 0) {
        playerNumber = 1;
        gameState.players[socket.id] = { player: 1, ready: false };
    } else if (playerCount === 1) {
        playerNumber = 2;
        gameState.players[socket.id] = { player: 2, ready: false };
    } else {
        socket.emit('gameFull');
        socket.disconnect();
        return;
    }
    
    socket.emit('playerAssigned', playerNumber);
    
    // Send current game state
    socket.emit('gameState', gameState);
    
    // Handle player ready
    socket.on('playerReady', () => {
        gameState.players[socket.id].ready = true;
        const allReady = Object.values(gameState.players).every(p => p.ready);
        if (allReady && Object.keys(gameState.players).length === 2) {
            gameState.gameRunning = true;
            resetBall();
            io.emit('gameStart', gameState);
        }
    });
    
    // Track last paddle update time per player to throttle
    const lastPaddleUpdate = {};
    
    // Handle paddle movement
    socket.on('paddleMove', (direction) => {
        if (!gameState.gameRunning) return;
        
        const player = gameState.players[socket.id];
        if (!player) return;
        
        // Throttle paddle updates to prevent spam
        const now = Date.now();
        if (lastPaddleUpdate[socket.id] && now - lastPaddleUpdate[socket.id] < 16) {
            return; // Skip if too frequent
        }
        lastPaddleUpdate[socket.id] = now;
        
        const paddleSpeed = 12;
        const paddleHeight = 100;
        const maxY = 600 - paddleHeight;
        
        if (player.player === 1) {
            if (direction === 'up' && gameState.paddle1.y > 0) {
                gameState.paddle1.y = Math.max(0, gameState.paddle1.y - paddleSpeed);
            } else if (direction === 'down' && gameState.paddle1.y < maxY) {
                gameState.paddle1.y = Math.min(maxY, gameState.paddle1.y + paddleSpeed);
            }
        } else if (player.player === 2) {
            if (direction === 'up' && gameState.paddle2.y > 0) {
                gameState.paddle2.y = Math.max(0, gameState.paddle2.y - paddleSpeed);
            } else if (direction === 'down' && gameState.paddle2.y < maxY) {
                gameState.paddle2.y = Math.min(maxY, gameState.paddle2.y + paddleSpeed);
            }
        }
        
        // Only emit paddle updates, not full game state
        io.emit('paddleUpdate', {
            paddle1: gameState.paddle1,
            paddle2: gameState.paddle2
        });
    });
    
    // Handle disconnection
    socket.on('disconnect', () => {
        console.log('Player disconnected:', socket.id);
        delete gameState.players[socket.id];
        if (Object.keys(gameState.players).length === 0) {
            resetGame();
        } else {
            gameState.gameRunning = false;
            io.emit('playerDisconnected');
        }
    });
});

function resetBall() {
    gameState.ball.x = 400;
    gameState.ball.y = 300;
    gameState.ball.velocityX = (Math.random() > 0.5 ? 1 : -1) * 5;
    gameState.ball.velocityY = (Math.random() - 0.5) * 5;
}

function resetGame() {
    gameState.ball.x = 400;
    gameState.ball.y = 300;
    gameState.paddle1.y = 250;
    gameState.paddle2.y = 250;
    gameState.score.player1 = 0;
    gameState.score.player2 = 0;
    gameState.gameRunning = false;
}

// Game loop - update ball position (optimized to 30 FPS for better performance)
setInterval(() => {
    if (gameState.gameRunning && Object.keys(gameState.players).length === 2) {
        // Update ball position (simplified for consistency)
        gameState.ball.x += gameState.ball.velocityX;
        gameState.ball.y += gameState.ball.velocityY;
        
        // Ball collision with top and bottom walls
        const ballRadius = 10;
        if (gameState.ball.y - ballRadius <= 0 || gameState.ball.y + ballRadius >= 600) {
            gameState.ball.velocityY = -gameState.ball.velocityY;
            // Keep ball within bounds
            if (gameState.ball.y - ballRadius <= 0) {
                gameState.ball.y = ballRadius;
            } else if (gameState.ball.y + ballRadius >= 600) {
                gameState.ball.y = 600 - ballRadius;
            }
        }
        
        // Ball collision with paddles
        const paddleWidth = 10;
        const paddleHeight = 100;
        
        // Left paddle (player 1)
        const paddle1X = 20;
        const paddle1Right = paddle1X + paddleWidth;
        if (gameState.ball.x - ballRadius <= paddle1Right && 
            gameState.ball.x + ballRadius >= paddle1X &&
            gameState.ball.y + ballRadius >= gameState.paddle1.y &&
            gameState.ball.y - ballRadius <= gameState.paddle1.y + paddleHeight) {
            if (gameState.ball.velocityX < 0) { // Only bounce if moving left
                // Accelerate ball by 2% on each hit
                gameState.ball.velocityX = -gameState.ball.velocityX * 1.02;
                gameState.ball.velocityY = gameState.ball.velocityY * 1.02;
                gameState.ball.x = paddle1Right + ballRadius;
            }
        }
        
        // Right paddle (player 2)
        const paddle2X = 770;
        const paddle2Right = paddle2X + paddleWidth;
        if (gameState.ball.x - ballRadius <= paddle2Right && 
            gameState.ball.x + ballRadius >= paddle2X &&
            gameState.ball.y + ballRadius >= gameState.paddle2.y &&
            gameState.ball.y - ballRadius <= gameState.paddle2.y + paddleHeight) {
            if (gameState.ball.velocityX > 0) { // Only bounce if moving right
                // Accelerate ball by 2% on each hit
                gameState.ball.velocityX = -gameState.ball.velocityX * 1.02;
                gameState.ball.velocityY = gameState.ball.velocityY * 1.02;
                gameState.ball.x = paddle2X - ballRadius;
            }
        }
        
        // Score points
        if (gameState.ball.x < -ballRadius) {
            gameState.score.player2++;
            resetBall();
            if (gameState.score.player2 >= 5) {
                gameState.gameRunning = false;
                io.emit('gameOver', { winner: 'Player 2' });
            } else {
                io.emit('pointScored', { player: 2 });
            }
        } else if (gameState.ball.x > 800 + ballRadius) {
            gameState.score.player1++;
            resetBall();
            if (gameState.score.player1 >= 5) {
                gameState.gameRunning = false;
                io.emit('gameOver', { winner: 'Player 1' });
            } else {
                io.emit('pointScored', { player: 1 });
            }
        }
        
        // Only emit ball updates (not full state) to reduce payload
        io.emit('ballUpdate', {
            ball: gameState.ball,
            score: gameState.score
        });
    }
}, 33); // ~30 FPS for network updates (reduced from 60 FPS)

// Start the server
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
});