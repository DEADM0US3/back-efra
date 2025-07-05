const express = require('express');
const path = require('path');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const fetch = require('node-fetch');
const dotenv = require('dotenv');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

dotenv.config();
const app = express();
const port = process.env.PORT || 3000;

const JWT_SECRET       = process.env.JWT_SECRET       || 'secreto123';
const RECAPTCHA_SECRET = process.env.RECAPTCHA_SECRET || 'TU_SECRET_KEY';
const DISCORD_WEBHOOK  = process.env.DISCORD_WEBHOOK  || null;

app.use(cors());
app.use(express.json());        // <-- JSON bodies
//app.use(express.urlencoded({ extended: true })); // opcional, ya no necesario

// DB Init
const db = new sqlite3.Database('./data/form.db', err => {
  if (err) console.error('Error al abrir la DB', err.message);
  else {
    db.run(`CREATE TABLE IF NOT EXISTS formulario (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT,
      correo TEXT,
      telefono TEXT,
      mensaje TEXT,
      estado TEXT DEFAULT 'nuevo',
      fecha TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario TEXT UNIQUE,
      password TEXT
    )`);
  }
});

function sanitize(input) {
  if (typeof input !== 'string') return '';
  return input.replace(/<[^>]*>?/gm, '').trim();
}

function verificarToken(req, res, next) {
  const auth = req.headers['authorization']?.split(' ')[1];
  if (!auth) return res.status(401).json({ error: 'Token requerido' });
  jwt.verify(auth, JWT_SECRET, (e, user) => {
    if (e) return res.status(403).json({ error: 'Token inválido' });
    req.user = user;
    next();
  });
}

// — POST /login
app.post('/login', async (req, res) => {
  const { usuario, password } = req.body;
  if (!usuario || !password)
    return res.status(400).json({ error: 'Usuario y contraseña requeridos' });

  db.get(`SELECT * FROM usuarios WHERE usuario = ?`, [usuario], async (err, row) => {
    if (err) return res.status(500).json({ error: 'Error en la DB' });
    if (!row) return res.status(401).json({ error: 'Credenciales inválidas' });
    const ok = await bcrypt.compare(password, row.password);
    if (!ok) return res.status(401).json({ error: 'Credenciales inválidas' });
    const token = jwt.sign({ id: row.id, usuario: row.usuario }, JWT_SECRET, { expiresIn: '2h' });
    res.json({ token });
  });
});

// — POST /formulario
app.post('/formulario', async (req, res) => {
  const { nombre, correo, telefono, mensaje, 'g-recaptcha-response': token } = req.body;
  if (!token) return res.status(400).json({ error: 'Falta el token de reCAPTCHA' });

  try {
    const resp = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `secret=${RECAPTCHA_SECRET}&response=${token}`,
    });
    const data = await resp.json();
    if (!data.success) return res.status(400).json({ error: 'Falló reCAPTCHA' });

    db.run(
        `INSERT INTO formulario (nombre, correo, telefono, mensaje) VALUES (?, ?, ?, ?)`,
        [sanitize(nombre), sanitize(correo), sanitize(telefono), sanitize(mensaje)],
        function(err) {
          if (err) return res.status(500).json({ error: 'Error al guardar' });

          // Discord webhook
          if (DISCORD_WEBHOOK) {
            fetch(DISCORD_WEBHOOK, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                username: 'CRM Bot',
                embeds: [{
                  title: '📥 Nuevo lead recibido',
                  fields: [
                    { name: 'Nombre',  value: sanitize(nombre),  inline: true },
                    { name: 'Correo',  value: sanitize(correo),  inline: true },
                    { name: 'Teléfono', value: sanitize(telefono), inline: true },
                    { name: 'Mensaje', value: sanitize(mensaje) }
                  ],
                  timestamp: new Date().toISOString()
                }]
              })
            }).catch(console.error);
          }

          res.status(201).json({
            success: true,
            lead: { id: this.lastID, nombre, correo, telefono, mensaje }
          });
        }
    );
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error de verificación reCAPTCHA' });
  }
});

// — GET /leads
app.get('/leads', verificarToken, (req, res) => {
  const page    = parseInt(req.query.page)    || 1;
  const perPage = parseInt(req.query.perPage) || 10;
  const offset  = (page - 1) * perPage;

  db.all(`SELECT COUNT(*) AS total FROM formulario`, [], (e, cnt) => {
    if (e) return res.status(500).json({ error: 'Error conteo' });
    db.all(
        `SELECT * FROM formulario ORDER BY fecha DESC LIMIT ? OFFSET ?`,
        [perPage, offset],
        (err, rows) => {
          if (err) return res.status(500).json({ error: 'Error al obtener leads' });
          res.json({ total: cnt[0].total, page, perPage, leads: rows });
        }
    );
  });
});

// — PUT /leads/:id
app.put('/leads/:id', verificarToken, (req, res) => {
  const id    = req.params.id;
  const estado = sanitize(req.body.estado);
  if (!['nuevo','contactado','descartado'].includes(estado))
    return res.status(400).json({ error: 'Estado inválido' });

  db.run(`UPDATE formulario SET estado = ? WHERE id = ?`, [estado, id], function(err) {
    if (err) return res.status(500).json({ error: 'Error al actualizar estado' });
    res.json({ success: true, mensaje: 'Estado actualizado' });
  });
});

// Static (landing)
app.use(express.static(path.join(__dirname, 'public')));

app.listen(port, () =>
    console.log(`Servidor JSON corriendo en http://localhost:${port}`)
);
