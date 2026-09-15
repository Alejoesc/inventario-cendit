const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
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
        email TEXT,
        password TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'Usuario (Con permisos)',
        direction_id INTEGER REFERENCES directions(id) ON DELETE SET NULL
      );
    `);

    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS items (
        id SERIAL PRIMARY KEY,
        direction_id INTEGER REFERENCES directions(id) ON DELETE SET NULL,
        item_category TEXT NOT NULL DEFAULT 'Material', -- Material, Fibra, Cable Coaxial, Equipo
        description TEXT NOT NULL,
        national_asset_number TEXT,
        unit_type TEXT NOT NULL DEFAULT 'unidades', 
        quantity REAL NOT NULL,
        price NUMERIC(12, 2) DEFAULT 0.00,
        location TEXT, -- Ubicación física exacta
        project_name TEXT,
        assigned_to TEXT -- Persona o unidad responsable independiente
      );
    `);

    await pool.query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS item_category TEXT DEFAULT 'Material';`);
    await pool.query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS location TEXT;`);

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
        signature_data TEXT, -- Firma digital del solicitante
        date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await pool.query(`ALTER TABLE loans ADD COLUMN IF NOT EXISTS signature_data TEXT;`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS purchase_requests (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        direction_id INTEGER REFERENCES directions(id),
        item_description TEXT NOT NULL,
        quantity REAL NOT NULL,
        currency_type TEXT DEFAULT 'USD', -- USD o EUR
        estimated_price NUMERIC(12, 2) DEFAULT 0.00,
        estimated_price_bs NUMERIC(12, 2) DEFAULT 0.00,
        quotation_ref TEXT,
        existing_item_id INTEGER REFERENCES items(id) ON DELETE SET NULL,
        status TEXT DEFAULT 'PENDIENTE',
        supervisor_notes TEXT,
        date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    await pool.query(`ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS currency_type TEXT DEFAULT 'USD';`);
    await pool.query(`ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS estimated_price_bs NUMERIC(12, 2) DEFAULT 0.00;`);
    await pool.query(`ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS quotation_ref TEXT;`);
    await pool.query(`ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS existing_item_id INTEGER REFERENCES items(id) ON DELETE SET NULL;`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        sender_id INTEGER REFERENCES users(id),
        target_direction_id INTEGER REFERENCES directions(id) ON DELETE SET NULL,
        target_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        message TEXT NOT NULL,
        is_request BOOLEAN DEFAULT FALSE,
        item_description TEXT,
        quantity REAL,
        status TEXT DEFAULT 'PENDIENTE_APROBACION',
        date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS target_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id SERIAL PRIMARY KEY,
        username TEXT,
        action TEXT NOT NULL,
        details TEXT,
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
      INSERT INTO users (username, cedula, email, password, role, direction_id) 
      VALUES ('admin', 'V-00000000', 'admin@cendit.gob.ve', 'admin123', 'Administrador', 1) 
      ON CONFLICT (username) DO NOTHING;
    `);

    isInitialized = true;
    console.log('Base de datos PostgreSQL inicializada y sincronizada correctamente.');
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