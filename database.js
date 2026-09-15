const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  family: 4 // Fuerza el uso de IPv4 para evitar el error ENETUNREACH en Render
});

let isInitialized = false;

async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS directions (
        id SERIAL PRIMARY KEY,
        name TEXT UNIQUE NOT NULL
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        cedula TEXT UNIQUE,
        password TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'Operador',
        direction_id INTEGER REFERENCES directions(id) ON DELETE SET NULL
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS items (
        id SERIAL PRIMARY KEY,
        direction_id INTEGER REFERENCES directions(id) ON DELETE SET NULL,
        description TEXT NOT NULL,
        national_asset_number TEXT,
        unit_type TEXT NOT NULL DEFAULT 'unidades', 
        quantity REAL NOT NULL,
        price NUMERIC(12, 2) DEFAULT 0.00,
        project_name TEXT,
        assigned_username TEXT
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS loans (
        id SERIAL PRIMARY KEY,
        item_id INTEGER REFERENCES items(id),
        source_direction_id INTEGER REFERENCES directions(id),
        target_direction_id INTEGER REFERENCES directions(id),
        sender_responsible TEXT NOT NULL,
        receiver_responsible TEXT NOT NULL,
        quantity REAL NOT NULL,
        return_date TEXT,
        is_returnable TEXT NOT NULL DEFAULT 'SI',
        status TEXT DEFAULT 'PENDIENTE',
        date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS purchase_requests (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        direction_id INTEGER REFERENCES directions(id),
        item_description TEXT NOT NULL,
        quantity REAL NOT NULL,
        estimated_price NUMERIC(12, 2) DEFAULT 0.00,
        status TEXT DEFAULT 'PENDIENTE',
        supervisor_notes TEXT,
        date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const dirCount = await pool.query('SELECT COUNT(*) FROM directions');
    if (parseInt(dirCount.rows[0].count) === 0) {
      const defaultDirs = [
        'Dirección Ejecutiva',
        'Dirección de Tecnologías',
        'Unidad de Telemática',
        'Unidad de Fotónica',
        'Almacén DDI',
        'Almacén de Electrónica'
      ];
      for (const dir of defaultDirs) {
        await pool.query('INSERT INTO directions (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [dir]);
      }
    }

    await pool.query(`
      INSERT INTO users (username, cedula, password, role, direction_id) 
      VALUES ('admin', 'V-00000000', 'admin123', 'Administrador', 1) 
      ON CONFLICT (username) DO NOTHING;
    `);

    isInitialized = true;
    console.log('Base de datos PostgreSQL inicializada y sincronizada correctamente con IPv4.');
  } catch (err) {
    console.error('Error inicializando la base de datos:', err.message);
  }
}

const initPromise = initDB();

async function query(text, params) {
  if (!isInitialized) {
    await initPromise;
  }
  return pool.query(text, params);
}

module.exports = {
  query,
  pool
};