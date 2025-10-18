// server.js - Complete Node.js + Express + SQLite application
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcrypt');
const session = require('express-session');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || '$2b$10$example';

const Redis = require('redis');
const RedisStore = require('connect-redis').default;

// Create Redis client
const redisClient = Redis.createClient({
  url: process.env.REDIS_URL
});

redisClient.connect().catch(console.error);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(session({
  store: new RedisStore({ client: redisClient }),
  secret: process.env.SESSION_SECRET || 'change-this-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000
  }
}));

// Initialize SQLite Database
const db = new sqlite3.Database('./noticing.db', (err) => {
  if (err) console.error('Database error:', err);
  else console.log('Connected to SQLite database');
});

// Create tables
db.run(`CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  comment TEXT NOT NULL,
  name TEXT NOT NULL,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

// Helper function to convert UTC to PST
function toPST(utcDate) {
  const date = new Date(utcDate);
  return date.toLocaleString('en-US', { 
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
}

// Public API Routes
app.post('/api/comments', (req, res) => {
  const { comment, name } = req.body;
  
  // Validate comment
  if (!comment || !comment.trim() || /^[\s\p{P}]+$/u.test(comment.trim())) {
    return res.status(400).json({ error: 'write something to submit a comment / escribe algo para enviar un comentario' });
  }
  
  const finalName = name && name.trim() ? name.trim().substring(0, 50) : 'anonymous';
  const finalComment = comment.trim().substring(0, 500);
  
  db.run(
    'INSERT INTO comments (comment, name) VALUES (?, ?)',
    [finalComment, finalName],
    function(err) {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'Failed to save comment' });
      }
      res.json({ success: true, id: this.lastID });
    }
  );
});

app.get('/api/comments', (req, res) => {
  db.all('SELECT * FROM comments ORDER BY timestamp DESC', [], (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to fetch comments' });
    }
    
    const comments = rows.map(row => ({
      id: row.id,
      comment: row.comment,
      name: row.name,
      timestamp: toPST(row.timestamp)
    }));
    
    res.json(comments);
  });
});

// Admin Routes
app.post('/api/admin/login', async (req, res) => {
  const { password } = req.body;
  
  try {
    const match = await bcrypt.compare(password, ADMIN_PASSWORD_HASH);
    if (match) {
      req.session.isAdmin = true;
      req.session.save((err) => {
        if (err) {
          console.log('Session save error:', err);
          return res.status(500).json({ error: 'Session save failed' });
        }
        console.log('Login successful, session saved:', req.session);
        res.json({ success: true });
      });
    } else {
      res.status(401).json({ error: 'Invalid password' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Authentication error' });
  }
});

app.post('/api/admin/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.delete('/api/admin/comments/:id', (req, res) => {
  console.log('Delete request - Session:', req.session);
  console.log('Is admin?', req.session.isAdmin);
  
  if (!req.session.isAdmin) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  
  db.run('DELETE FROM comments WHERE id = ?', [req.params.id], (err) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to delete comment' });
    }
    res.json({ success: true });
  });
});

app.get('/api/admin/check', (req, res) => {
  res.json({ isAdmin: !!req.session.isAdmin });
});

// Serve HTML pages
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log('Visit http://localhost:' + PORT);
});