const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'data', 'game.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    db.run("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password_hash TEXT, avatar TEXT, games_played INTEGER DEFAULT 0, games_won INTEGER DEFAULT 0, best_score INTEGER DEFAULT 0, xp INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)");
    db.run("ALTER TABLE users ADD COLUMN xp INTEGER DEFAULT 0", (err) => {});
});

const registerUser = (username, password, avatar, callback) => {
    db.get('SELECT * FROM users WHERE username = ?', [username], (err, row) => {
        if (err) return callback({ error: 'Erreur serveur.' });
        if (row) return callback({ error: 'Ce pseudo est d�j� utilis�.' });

        const salt = bcrypt.genSaltSync(10);
        const hash = bcrypt.hashSync(password, salt);

        db.run(
            'INSERT INTO users (username, password_hash, avatar) VALUES (?, ?, ?)',
            [username, hash, avatar],
            function(err) {
                if (err) return callback({ error: 'Erreur lors de l inscription.' });
                callback({ success: true, userId: this.lastID, username, avatar });
            }
        );
    });
};

const loginUser = (username, password, callback) => {
    db.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
        if (err) return callback({ error: 'Erreur serveur.' });
        if (!user) return callback({ error: 'Identifiant ou mot de passe incorrect.' });

        if (bcrypt.compareSync(password, user.password_hash)) {
            callback({ 
                success: true, 
                userId: user.id, 
                username: user.username, 
                avatar: user.avatar,
                stats: {
                    jouees: user.games_played,
                    gagnees: user.games_won,
                    meilleurScore: user.best_score,
                    xp: user.xp
                }
            });
        } else {
            callback({ error: 'Identifiant ou mot de passe incorrect.' });
        }
    });
};

const getUserStats = (userId, callback) => {
    db.get('SELECT games_played, games_won, best_score, xp, avatar FROM users WHERE id = ?', [userId], (err, row) => {
        if (err || !row) return callback(null);
        callback({
            jouees: row.games_played,
            gagnees: row.games_won,
            meilleurScore: row.best_score,
            xp: row.xp,
            avatar: row.avatar
        });
    });
};

const updateUserStats = (userId, isWin, score) => {
    if (!userId) return;
    db.get('SELECT best_score, xp FROM users WHERE id = ?', [userId], (err, row) => {
        if (err || !row) return;
        let newBest = row.best_score;
        if (score > newBest) newBest = score;
        let winIncrement = isWin ? 1 : 0;
        let gainedXp = isWin ? 150 : 25;
        db.run(
            'UPDATE users SET games_played = games_played + 1, games_won = games_won + ?, best_score = ?, xp = xp + ? WHERE id = ?',
            [winIncrement, newBest, gainedXp, userId]
        );
    });
};

const getLeaderboard = (callback) => {
    db.all('SELECT username, avatar, xp, games_won, best_score FROM users ORDER BY xp DESC, best_score DESC LIMIT 20', (err, rows) => {
        if (err) return callback([]);
        callback(rows);
    });
};

module.exports = {
    registerUser,
    loginUser,
    getUserStats,
    updateUserStats,
    getLeaderboard
};
