const express = require('express');
const path = require('path');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const port = 3000;
const RECAPTCHA_SECRET = 'TU_SECRET_KEY'; // Coloca aquí tu clave secreta

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Sirve el HTML en /
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// DB Init
const db = new sqlite3.Database('./data/form.db', (err) => {
  if (err) console.error('Error al abrir la DB', err.message);
  else {
    db.run(`CREATE TABLE IF NOT EXISTS formulario (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT,
      correo TEXT,
      telefono TEXT,
      mensaje TEXT
    )`);
  }
});

// Función simple para sanitizar texto (quita etiquetas HTML)
function sanitize(input) {
  if (typeof input !== 'string') return '';
  return input.replace(/<[^>]*>?/gm, '').trim();
}

app.post('/formulario', async (req, res) => {
  
  // Sanitizar entrada
  const nombre = sanitize(req.body.nombre);
  const correo = sanitize(req.body.correo);
  const telefono = sanitize(req.body.telefono);
  const mensaje = sanitize(req.body.mensaje);
  const token = req.body['g-recaptcha-response'];

  if (!token) {
    return res.redirect('/?error=Falta el token de reCAPTCHA');
  }

  try {
    const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `secret=6Lc-j2wrAAAAADDq80B6o4FAyyOjzGAqUTFKYOO-&response=${token}`,
    });

    const data = await response.json();
    console.log("reCAPTCHA respuesta:", data);

    if (!data.success) {
      
      return res.redirect('/?error=Falló la verificación de reCAPTCHA');
    }

    db.run(
      `INSERT INTO formulario (nombre, correo, telefono, mensaje) VALUES (?, ?, ?, ?)`,
      [nombre, correo, telefono, mensaje],
      function (err) {
        if (err) {
          console.error(err.message);
          return res.redirect('/?error=Error al guardar');
          return res.status(500).json({ error: 'Error al guardar' });
        }

        res.redirect('/?success=Formulario enviado con éxito');

      }
    );

  } catch (err) {
    console.error('Error al verificar reCAPTCHA:', err);
    return res.redirect('/?error=Error al verificar reCAPTCHA');
  }
});


app.listen(port, () => {
  console.log(`Servidor corriendo en http://localhost:${port}`);
});
