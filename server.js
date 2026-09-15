const express = require('express');
const db = require('./database');
const app = express();

app.use(express.json());
app.use(express.static('public'));

async function authMiddleware(req, res, next) {
  const username = req.headers['x-user'];
  if (!username) return res.status(401).json({ error: 'No autenticado' });

  try {
    const result = await db.query('SELECT * FROM users WHERE username = $1 OR cedula = $1', [username]);
    if (result.rows.length === 0) return res.status(401).json({ error: 'Usuario no válido' });
    req.user = result.rows[0];
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

function adminMiddleware(req, res, next) {
  if (!req.user || req.user.role !== 'Administrador') {
    return res.status(403).json({ error: 'Acceso denegado: Se requiere rol de Supervisor / Administrador.' });
  }
  next();
}

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Ingrese usuario o cédula y contraseña' });

  try {
    const result = await db.query(
      'SELECT * FROM users WHERE (username = $1 OR cedula = $1) AND password = $2',
      [username.trim(), password.trim()]
    );
    if (result.rows.length === 0) return res.status(401).json({ error: 'Usuario, cédula o contraseña incorrectos' });
    const user = result.rows[0];
    res.json({ message: 'Login exitoso', user: { username: user.username, role: user.role } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/users', authMiddleware, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT users.*, directions.name as direction_name 
      FROM users 
      LEFT JOIN directions ON users.direction_id = directions.id
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/users', authMiddleware, adminMiddleware, async (req, res) => {
  const { username, cedula, email, password, role, direction_id } = req.body;
  try {
    await db.query(
      `INSERT INTO users (username, cedula, email, password, role, direction_id) VALUES ($1, $2, $3, $4, $5, $6)`,
      [username, cedula, email || null, password, role || 'Operador', direction_id || null]
    );
    res.json({ message: 'Usuario creado exitosamente' });
  } catch (err) {
    res.status(500).json({ error: 'El usuario, la cédula o el correo ya existen' });
  }
});

app.delete('/api/users/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    await db.query('DELETE FROM users WHERE id = $1 AND id != 1', [req.params.id]);
    res.json({ message: 'Usuario eliminado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/directions', authMiddleware, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM directions');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/directions', authMiddleware, adminMiddleware, async (req, res) => {
  const { name } = req.body;
  try {
    await db.query('INSERT INTO directions (name) VALUES ($1)', [name]);
    res.json({ message: 'Dirección agregada' });
  } catch (err) {
    res.status(500).json({ error: 'La dirección ya existe' });
  }
});

app.delete('/api/directions/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    await db.query('DELETE FROM directions WHERE id = $1', [req.params.id]);
    res.json({ message: 'Dirección eliminada' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/items', authMiddleware, async (req, res) => {
  try {
    let queryText = `
      SELECT items.*, directions.name as direction_name 
      FROM items 
      LEFT JOIN directions ON items.direction_id = directions.id
    `;
    let params = [];

    if (req.user.role !== 'Administrador') {
      queryText += ` WHERE items.direction_id = $1`;
      params.push(req.user.direction_id);
    }

    const result = await db.query(queryText, params);
    const items = result.rows.map(i => {
      const threshold = i.unit_type === 'metros' ? 100 : 10;
      return { ...i, alerta_reposicion: i.quantity <= threshold };
    });
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/items', authMiddleware, async (req, res) => {
  let { direction_id, description, national_asset_number, unit_type, quantity, price, project_name, assigned_username } = req.body;
  
  if (req.user.role !== 'Administrador') {
    direction_id = req.user.direction_id;
  }

  try {
    await db.query(
      `INSERT INTO items (direction_id, description, national_asset_number, unit_type, quantity, price, project_name, assigned_username) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [direction_id, description, national_asset_number || null, unit_type || 'unidades', quantity, price || 0, project_name || 'General', assigned_username || req.user.username]
    );
    res.json({ message: 'Artículo registrado y asignado correctamente' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/loans', authMiddleware, async (req, res) => {
  try {
    let queryText = `
      SELECT loans.*, 
             items.description as item_name, 
             items.national_asset_number,
             items.unit_type,
             items.price,
             items.project_name,
             d1.name as source_direction_name, 
             d2.name as target_direction_name,
             u1.cedula as sender_cedula,
             du1.name as sender_direction_name,
             u2.cedula as receiver_cedula,
             du2.name as receiver_direction_name
      FROM loans 
      JOIN items ON loans.item_id = items.id
      LEFT JOIN directions d1 ON loans.source_direction_id = d1.id
      LEFT JOIN directions d2 ON loans.target_direction_id = d2.id
      LEFT JOIN users u1 ON loans.sender_responsible = u1.username
      LEFT JOIN directions du1 ON u1.direction_id = du1.id
      LEFT JOIN users u2 ON loans.receiver_responsible = u2.username
      LEFT JOIN directions du2 ON u2.direction_id = du2.id
    `;
    let params = [];

    if (req.user.role !== 'Administrador') {
      queryText += ` WHERE loans.source_direction_id = $1 OR loans.target_direction_id = $1`;
      params.push(req.user.direction_id);
    }

    const result = await db.query(queryText, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/loans', authMiddleware, async (req, res) => {
  const { item_id, target_direction_id, receiver_responsible, quantity, return_date, is_returnable } = req.body;
  const sender_responsible = req.user.username;

  try {
    const itemRes = await db.query('SELECT * FROM items WHERE id = $1', [item_id]);
    if (itemRes.rows.length === 0) return res.status(404).json({ error: 'Artículo no encontrado' });
    const item = itemRes.rows[0];

    if (item.quantity < quantity) return res.status(400).json({ error: 'Stock insuficiente' });

    const finalIsReturnable = is_returnable === 'SI' ? 'SI' : 'NO';
    const finalReturnDate = finalIsReturnable === 'SI' ? (return_date || 'Sin fecha') : 'No aplica';

    await db.query(
      `INSERT INTO loans (item_id, source_direction_id, target_direction_id, sender_responsible, receiver_responsible, quantity, return_date, is_returnable, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'PENDIENTE')`,
      [item_id, item.direction_id, target_direction_id, sender_responsible, receiver_responsible, quantity, finalReturnDate, finalIsReturnable]
    );
    res.json({ message: 'Solicitud de préstamo registrada. Pendiente de aprobación.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/loans/:id/approve', authMiddleware, adminMiddleware, async (req, res) => {
  const client = await db.pool.connect();
  try {
    const loanRes = await client.query("SELECT * FROM loans WHERE id = $1 AND status = 'PENDIENTE'", [req.params.id]);
    if (loanRes.rows.length === 0) {
      client.release();
      return res.status(404).json({ error: 'Solicitud no encontrada o ya procesada' });
    }
    const loan = loanRes.rows[0];

    const itemRes = await client.query('SELECT * FROM items WHERE id = $1', [loan.item_id]);
    if (itemRes.rows.length === 0 || itemRes.rows[0].quantity < loan.quantity) {
      client.release();
      return res.status(400).json({ error: 'Stock insuficiente' });
    }

    await client.query('BEGIN');
    await client.query('UPDATE items SET quantity = quantity - $1 WHERE id = $2', [loan.quantity, loan.item_id]);
    await client.query("UPDATE loans SET status = 'ACTIVO' WHERE id = $1", [req.params.id]);
    await client.query('COMMIT');
    client.release();

    res.json({ message: 'Préstamo aprobado y stock descontado' });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (e) {}
    client.release();
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/loans/:id/reject', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const result = await db.query("UPDATE loans SET status = 'RECHAZADO' WHERE id = $1 AND status = 'PENDIENTE'", [req.params.id]);
    if (result.rowCount === 0) return res.status(400).json({ error: 'No se pudo rechazar' });
    res.json({ message: 'Solicitud rechazada.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/loans/:id/return', authMiddleware, async (req, res) => {
  const client = await db.pool.connect();
  try {
    const loanRes = await client.query("SELECT * FROM loans WHERE id = $1 AND status = 'ACTIVO'", [req.params.id]);
    if (loanRes.rows.length === 0) {
      client.release();
      return res.status(404).json({ error: 'Préstamo activo no encontrado' });
    }
    const loan = loanRes.rows[0];

    await client.query('BEGIN');
    if (loan.is_returnable === 'SI') {
      await client.query('UPDATE items SET quantity = quantity + $1 WHERE id = $2', [loan.quantity, loan.item_id]);
    }
    await client.query("UPDATE loans SET status = 'DEVUELTO' WHERE id = $1", [req.params.id]);
    await client.query('COMMIT');
    client.release();

    res.json({ message: 'Cierre de préstamo procesado con éxito' });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (e) {}
    client.release();
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/purchase-requests', authMiddleware, async (req, res) => {
  try {
    let queryText = `
      SELECT purchase_requests.*, users.username, users.cedula, directions.name as direction_name
      FROM purchase_requests
      JOIN users ON purchase_requests.user_id = users.id
      LEFT JOIN directions ON purchase_requests.direction_id = directions.id
    `;
    let params = [];
    if (req.user.role !== 'Administrador') {
      queryText += ` WHERE purchase_requests.direction_id = $1`;
      params.push(req.user.direction_id);
    }
    const result = await db.query(queryText, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/purchase-requests', authMiddleware, async (req, res) => {
  const { item_description, quantity, estimated_price } = req.body;
  try {
    await db.query(
      `INSERT INTO purchase_requests (user_id, direction_id, item_description, quantity, estimated_price, status) VALUES ($1, $2, $3, $4, $5, 'PENDIENTE')`,
      [req.user.id, req.user.direction_id || 1, item_description, quantity, estimated_price || 0]
    );
    res.json({ message: 'Solicitud de cotización enviada al jefe de unidad.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/purchase-requests/:id/return', authMiddleware, adminMiddleware, async (req, res) => {
  const { notes } = req.body;
  try {
    await db.query(
      `UPDATE purchase_requests SET status = 'DEVUELTO', supervisor_notes = $1 WHERE id = $2`,
      [notes || 'Revisar especificaciones de cotización', req.params.id]
    );
    res.json({ message: 'Solicitud devuelta al usuario con observaciones.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/purchase-requests/:id/approve', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    await db.query(`UPDATE purchase_requests SET status = 'APROBADO' WHERE id = $1`, [req.params.id]);
    res.json({ message: 'Solicitud de cotización aprobada.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API DE CHAT Y SOLICITUDES INTERDEPARTAMENTALES
app.get('/api/messages', authMiddleware, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT messages.*, users.username, users.role, directions.name as direction_name,
             target_dir.name as target_direction_name
      FROM messages
      JOIN users ON messages.sender_id = users.id
      LEFT JOIN directions ON users.direction_id = directions.id
      LEFT JOIN directions target_dir ON messages.target_direction_id = target_dir.id
      ORDER BY messages.date ASC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/messages', authMiddleware, async (req, res) => {
  const { target_direction_id, message, is_request, item_description, quantity } = req.body;
  try {
    await db.query(
      `INSERT INTO messages (sender_id, target_direction_id, message, is_request, item_description, quantity, status) 
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        req.user.id, 
        target_direction_id || null, 
        message, 
        is_request || false, 
        item_description || null, 
        quantity || null, 
        is_request ? 'PENDIENTE_UNIDAD' : 'APROBADO_UNIDAD'
      ]
    );
    res.json({ message: 'Mensaje enviado con éxito' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Visto bueno de la unidad receptora
app.post('/api/messages/:id/approve-unit', authMiddleware, async (req, res) => {
  try {
    const msgRes = await db.query('SELECT * FROM messages WHERE id = $1', [req.params.id]);
    if (msgRes.rows.length === 0) return res.status(404).json({ error: 'Solicitud no encontrada' });
    const msg = msgRes.rows[0];

    // Verificar si el usuario pertenece a la unidad destino o es Administrador
    if (req.user.role !== 'Administrador' && req.user.direction_id !== msg.target_direction_id) {
      return res.status(403).json({ error: 'Solo personal de la unidad receptora puede dar el visto bueno.' });
    }

    await db.query("UPDATE messages SET status = 'APROBADO_UNIDAD' WHERE id = $1", [req.params.id]);
    res.json({ message: 'Visto bueno otorgado por la unidad.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Aprobación de supervisor / administrador (Escalamiento o aprobación directa)
app.post('/api/messages/:id/approve-supervisor', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    await db.query("UPDATE messages SET status = 'APROBADO_SUPERVISOR' WHERE id = $1", [req.params.id]);
    res.json({ message: 'Solicitud aprobada por Supervisor / Administrador.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/messages/:id/reject', authMiddleware, async (req, res) => {
  try {
    const msgRes = await db.query('SELECT * FROM messages WHERE id = $1', [req.params.id]);
    if (msgRes.rows.length === 0) return res.status(404).json({ error: 'Solicitud no encontrada' });
    const msg = msgRes.rows[0];

    if (req.user.role !== 'Administrador' && req.user.direction_id !== msg.target_direction_id) {
      return res.status(403).json({ error: 'No autorizado para rechazar esta solicitud.' });
    }

    await db.query("UPDATE messages SET status = 'RECHAZADO' WHERE id = $1", [req.params.id]);
    res.json({ message: 'Solicitud rechazada.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor activo en puerto ${PORT}`));