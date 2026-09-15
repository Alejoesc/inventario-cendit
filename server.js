const express = require('express');
const db = require('./database');
const app = express();

app.use(express.json());
app.use(express.static('public'));

function authMiddleware(req, res, next) {
  const username = req.headers['x-user'];
  if (!username) return res.status(401).json({ error: 'No autenticado' });

  db.get(`SELECT * FROM users WHERE username = ?`, [username], (err, user) => {
    if (err || !user) return res.status(401).json({ error: 'Usuario no válido' });
    req.user = user;
    next();
  });
}

function adminMiddleware(req, res, next) {
  if (!req.user || req.user.role !== 'Administrador') {
    return res.status(403).json({ error: 'Acceso denegado: Se requiere rol de Supervisor / Administrador.' });
  }
  next();
}

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Ingrese usuario y contraseña' });

  db.get(`SELECT * FROM users WHERE username = ? AND password = ?`, [username.trim(), password.trim()], (err, user) => {
    if (err || !user) return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    res.json({ message: 'Login exitoso', user: { username: user.username, role: user.role } });
  });
});

app.get('/api/users', authMiddleware, (req, res) => {
  db.all(`SELECT id, username, cedula, role FROM users`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/users', authMiddleware, adminMiddleware, (req, res) => {
  const { username, cedula, password, role } = req.body;
  db.run(`INSERT INTO users (username, cedula, password, role) VALUES (?, ?, ?, ?)`, [username, cedula, password, role || 'Operador'], function(err) {
    if (err) return res.status(500).json({ error: 'El usuario o la cédula ya existen' });
    res.json({ message: 'Usuario creado exitosamente' });
  });
});

app.delete('/api/users/:id', authMiddleware, adminMiddleware, (req, res) => {
  db.run(`DELETE FROM users WHERE id = ? AND id != 1`, [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Usuario eliminado' });
  });
});

app.get('/api/directions', authMiddleware, (req, res) => {
  db.all(`SELECT * FROM directions`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/directions', authMiddleware, adminMiddleware, (req, res) => {
  const { name } = req.body;
  db.run(`INSERT INTO directions (name) VALUES (?)`, [name], function(err) {
    if (err) return res.status(500).json({ error: 'La dirección ya existe' });
    res.json({ message: 'Dirección agregada' });
  });
});

app.delete('/api/directions/:id', authMiddleware, adminMiddleware, (req, res) => {
  db.run(`DELETE FROM directions WHERE id = ?`, [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Dirección eliminada' });
  });
});

app.get('/api/items', authMiddleware, (req, res) => {
  db.all(`
    SELECT items.*, directions.name as direction_name 
    FROM items 
    LEFT JOIN directions ON items.direction_id = directions.id
  `, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const items = rows.map(i => {
      const threshold = i.unit_type === 'metros' ? 100 : 10;
      return { ...i, alerta_reposicion: i.quantity <= threshold };
    });
    res.json(items);
  });
});

app.post('/api/items', authMiddleware, (req, res) => {
  const { direction_id, description, national_asset_number, unit_type, quantity } = req.body;
  db.run(
    `INSERT INTO items (direction_id, description, national_asset_number, unit_type, quantity) VALUES (?, ?, ?, ?, ?)`,
    [direction_id, description, national_asset_number || null, unit_type || 'unidades', quantity],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: 'Artículo registrado correctamente' });
    }
  );
});

app.get('/api/loans', authMiddleware, (req, res) => {
  db.all(`
    SELECT loans.*, items.description as item_name, d1.name as source_direction_name, d2.name as target_direction_name 
    FROM loans 
    JOIN items ON loans.item_id = items.id
    LEFT JOIN directions d1 ON loans.source_direction_id = d1.id
    LEFT JOIN directions d2 ON loans.target_direction_id = d2.id
  `, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Crear préstamo (queda PENDIENTE de aprobación por supervisor y descuenta stock al aprobarse)
app.post('/api/loans', authMiddleware, (req, res) => {
  const { item_id, target_direction_id, receiver_responsible, quantity, return_date, is_returnable } = req.body;
  const sender_responsible = req.user.username; // Emisor bloqueado al usuario logueado

  db.get(`SELECT * FROM items WHERE id = ?`, [item_id], (err, item) => {
    if (err || !item) return res.status(404).json({ error: 'Artículo no encontrado' });
    if (item.quantity < quantity) return res.status(400).json({ error: 'Stock insuficiente' });

    const finalIsReturnable = is_returnable === 'SI' ? 'SI' : 'NO';
    const finalReturnDate = finalIsReturnable === 'SI' ? (return_date || 'Sin fecha') : 'No aplica';

    db.run(
      `INSERT INTO loans (item_id, source_direction_id, target_direction_id, sender_responsible, receiver_responsible, quantity, return_date, is_returnable, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDIENTE')`,
      [item_id, item.direction_id, target_direction_id, sender_responsible, receiver_responsible, quantity, finalReturnDate, finalIsReturnable],
      (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Solicitud de préstamo registrada. Pendiente de aprobación por el supervisor.' });
      }
    );
  });
});

// Aprobar préstamo (Solo Supervisor/Admin) -> Descuenta stock y pasa a ACTIVO
app.post('/api/loans/:id/approve', authMiddleware, adminMiddleware, (req, res) => {
  db.get(`SELECT * FROM loans WHERE id = ? AND status = 'PENDIENTE'`, [req.params.id], (err, loan) => {
    if (err || !loan) return res.status(404).json({ error: 'Solicitud no encontrada o ya procesada' });

    db.get(`SELECT * FROM items WHERE id = ?`, [loan.item_id], (err, item) => {
      if (err || !item || item.quantity < loan.quantity) {
        return res.status(400).json({ error: 'Stock insuficiente para aprobar esta solicitud' });
      }

      db.serialize(() => {
        db.run(`BEGIN TRANSACTION`);
        db.run(`UPDATE items SET quantity = quantity - ? WHERE id = ?`, [loan.quantity, loan.item_id]);
        db.run(`UPDATE loans SET status = 'ACTIVO' WHERE id = ?`, [req.params.id], (err) => {
          if (err) {
            db.run(`ROLLBACK`);
            return res.status(500).json({ error: err.message });
          }
          db.run(`COMMIT`);
          res.json({ message: 'Préstamo aprobado y stock descontado exitosamente' });
        });
      });
    });
  });
});

// Rechazar préstamo (Solo Supervisor/Admin)
app.post('/api/loans/:id/reject', authMiddleware, adminMiddleware, (req, res) => {
  db.run(`UPDATE loans SET status = 'RECHAZADO' WHERE id = ? AND status = 'PENDIENTE'`, [req.params.id], function(err) {
    if (err || this.changes === 0) return res.status(400).json({ error: 'No se pudo rechazar la solicitud' });
    res.json({ message: 'Solicitud de préstamo rechazada.' });
  });
});

// Devolver préstamo / Cerrar ciclo
app.post('/api/loans/:id/return', authMiddleware, (req, res) => {
  db.get(`SELECT * FROM loans WHERE id = ? AND status = 'ACTIVO'`, [req.params.id], (err, loan) => {
    if (err || !loan) return res.status(404).json({ error: 'Préstamo activo no encontrado' });

    db.serialize(() => {
      db.run(`BEGIN TRANSACTION`);
      if (loan.is_returnable === 'SI') {
        db.run(`UPDATE items SET quantity = quantity + ? WHERE id = ?`, [loan.quantity, loan.item_id]);
      }
      db.run(`UPDATE loans SET status = 'DEVUELTO' WHERE id = ?`, [req.params.id], (err) => {
        if (err) {
          db.run(`ROLLBACK`);
          return res.status(500).json({ error: err.message });
        }
        db.run(`COMMIT`);
        res.json({ message: 'Cierre de préstamo procesado con éxito' });
      });
    });
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor CENDIT en puerto ${PORT}`));