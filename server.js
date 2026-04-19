require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { v4: uuidv4 } = require('uuid');
const admin = require('firebase-admin');

// ── Firebase Admin ────────────────────────────────────────────────────────────
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'staredown-2026',
});
const db = admin.firestore();

// ── Express + Socket.io ───────────────────────────────────────────────────────
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use('/webhook', express.raw({ type: 'application/json' }));

// ── In-memory rooms ───────────────────────────────────────────────────────────
const rooms = new Map();

function makeCode() {
  return Math.random().toString(36).slice(2, 6).toUpperCase();
}

// ── Auth middleware ───────────────────────────────────────────────────────────
async function verifyToken(req, res, next) {
  const token = req.headers.authorization?.split('Bearer ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.user = await admin.auth().verifyIdToken(token);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

// Leaderboard
app.get('/api/leaderboard', async (req, res) => {
  const snap = await db.collection('users')
    .orderBy('totalWon', 'desc')
    .limit(20)
    .get();
  const board = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  res.json(board);
});

// Create Stripe checkout session for deposit
app.post('/api/deposit', verifyToken, async (req, res) => {
  const { roomCode, amount } = req.body; // amount in cents
  if (!amount || amount < 100) return res.status(400).json({ error: 'Min $1' });

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: [{
      price_data: {
        currency: 'usd',
        product_data: { name: `Staredown deposit — Room ${roomCode}` },
        unit_amount: amount,
      },
      quantity: 1,
    }],
    mode: 'payment',
    success_url: `${process.env.BASE_URL}/?room=${roomCode}&paid=1&session={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.BASE_URL}/?cancelled=1`,
    metadata: {
      roomCode,
      userId: req.user.uid,
      userName: req.user.name || req.user.email,
      amount: String(amount),
    },
  });

  res.json({ url: session.url });
});

// Stripe webhook — confirm payment
app.post('/webhook', async (req, res) => {
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      req.headers['stripe-signature'],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (e) {
    return res.status(400).send(`Webhook error: ${e.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const s = event.data.object;
    const { roomCode, userId, userName, amount } = s.metadata;
    const room = rooms.get(roomCode);
    if (room) {
      // Mark player as paid
      const pi = room.players.findIndex(p => p.userId === userId);
      if (pi !== -1) {
        room.players[pi].paid = true;
        room.players[pi].stripePaymentIntent = s.payment_intent;
        room.pot += parseInt(amount);
        io.to(roomCode).emit('player_paid', {
          playerIndex: pi,
          name: userName,
          pot: room.pot,
        });

        // Both paid → start countdown
        if (room.players.length === 2 && room.players.every(p => p.paid)) {
          room.state = 'countdown';
          io.to(roomCode).emit('start_countdown', {
            names: room.players.map(p => p.name),
            pot: room.pot,
          });
        }
      }
    }
  }

  res.json({ received: true });
});

// Payout winner (called after game ends)
app.post('/api/payout', verifyToken, async (req, res) => {
  const { roomCode } = req.body;
  const room = rooms.get(roomCode);
  if (!room || room.state !== 'finished') return res.status(400).json({ error: 'Invalid room' });
  if (room.payoutDone) return res.json({ message: 'Already paid out' });

  room.payoutDone = true;

  const winner = room.players[room.winnerIndex];
  const loser = room.players[room.loserIndex];

  // Update leaderboard in Firestore
  const winnerRef = db.collection('users').doc(winner.userId);
  const loserRef = db.collection('users').doc(loser.userId);

  await db.runTransaction(async t => {
    const winDoc = await t.get(winnerRef);
    const loseDoc = await t.get(loserRef);

    t.set(winnerRef, {
      name: winner.name,
      photo: winner.photo || '',
      wins: (winDoc.exists ? winDoc.data().wins : 0) + 1,
      losses: winDoc.exists ? winDoc.data().losses : 0,
      totalWon: (winDoc.exists ? winDoc.data().totalWon : 0) + room.pot,
      gamesPlayed: (winDoc.exists ? winDoc.data().gamesPlayed : 0) + 1,
    }, { merge: true });

    t.set(loserRef, {
      name: loser.name,
      photo: loser.photo || '',
      wins: loseDoc.exists ? loseDoc.data().wins : 0,
      losses: (loseDoc.exists ? loseDoc.data().losses : 0) + 1,
      totalWon: loseDoc.exists ? loseDoc.data().totalWon : 0,
      gamesPlayed: (loseDoc.exists ? loseDoc.data().gamesPlayed : 0) + 1,
    }, { merge: true });
  });

  // NOTE: Real money transfer requires Stripe Connect.
  // For now we log the intent and handle manually.
  console.log(`[PAYOUT] $${room.pot/100} to ${winner.name} (${winner.userId})`);

  res.json({ success: true, winner: winner.name, pot: room.pot });
});

// ── Socket.io ─────────────────────────────────────────────────────────────────
io.on('connection', socket => {

  socket.on('create_room', ({ userId, name, photo, deposit }) => {
    let code;
    do { code = makeCode(); } while (rooms.has(code));

    rooms.set(code, {
      code,
      players: [{ socketId: socket.id, userId, name, photo, deposit, paid: false }],
      state: 'waiting',
      pot: 0,
      winnerIndex: null,
      loserIndex: null,
      payoutDone: false,
      _ready: 0,
    });

    socket.join(code);
    socket.data.room = code;
    socket.data.userId = userId;
    socket.data.playerIndex = 0;
    socket.emit('room_created', { code, playerIndex: 0 });
  });

  socket.on('join_room', ({ code, userId, name, photo, deposit }) => {
    const room = rooms.get(code);
    if (!room) return socket.emit('error', 'Room not found');
    if (room.players.length >= 2) return socket.emit('error', 'Room is full');

    room.players.push({ socketId: socket.id, userId, name, photo, deposit, paid: false });

    socket.join(code);
    socket.data.room = code;
    socket.data.userId = userId;
    socket.data.playerIndex = 1;

    socket.emit('room_joined', {
      code,
      playerIndex: 1,
      players: room.players.map(p => ({ name: p.name, photo: p.photo, paid: p.paid })),
      pot: room.pot,
    });

    io.to(room.players[0].socketId).emit('opponent_joined', {
      name,
      photo,
      deposit,
    });
  });

  // Rejoin after payment redirect
  socket.on('rejoin_room', ({ code, userId }) => {
    const room = rooms.get(code);
    if (!room) return socket.emit('error', 'Room not found');
    const pi = room.players.findIndex(p => p.userId === userId);
    if (pi === -1) return socket.emit('error', 'Not in this room');

    room.players[pi].socketId = socket.id;
    socket.join(code);
    socket.data.room = code;
    socket.data.userId = userId;
    socket.data.playerIndex = pi;

    socket.emit('room_state', {
      code,
      playerIndex: pi,
      players: room.players.map(p => ({ name: p.name, photo: p.photo, paid: p.paid })),
      pot: room.pot,
      state: room.state,
    });
  });

  socket.on('blinked', async () => {
    const { room: code, playerIndex } = socket.data;
    const room = rooms.get(code);
    if (!room || room.state !== 'contest') return;

    room.state = 'finished';
    room.loserIndex = playerIndex;
    room.winnerIndex = playerIndex === 0 ? 1 : 0;

    io.to(code).emit('game_over', {
      winnerIndex: room.winnerIndex,
      loserIndex: room.loserIndex,
      winnerName: room.players[room.winnerIndex].name,
      loserName: room.players[room.loserIndex].name,
      pot: room.pot,
      roomCode: code,
    });
  });

  socket.on('contest_ready', () => {
    const { room: code } = socket.data;
    const room = rooms.get(code);
    if (!room) return;
    room._ready = (room._ready || 0) + 1;
    if (room._ready >= 2) {
      room.state = 'contest';
      io.to(code).emit('contest_start');
    }
  });

  socket.on('disconnect', () => {
    const { room: code } = socket.data;
    if (!code) return;
    const room = rooms.get(code);
    if (!room || room.state === 'finished') return;
    socket.to(code).emit('opponent_left');
    rooms.delete(code);
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => console.log(`Staredown v3 on port ${PORT}`));
