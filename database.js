const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./cendit_fotonica.db', (err) => {
  if (err) console.error('Error al abrir la base de datos', err.message);
  else console.log('Conectado a la base de datos SQLite - Inventario CENDIT.');
});

db.serialize(() => {
  // Tabla de Usuarios con Cédula
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    cedula TEXT UNIQUE,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'Operador'
  )`, () => {
    // Migración segura si la tabla ya existía sin columna cédula
    db.run(`ALTER TABLE users ADD COLUMN cedula TEXT`, (err) => {});
    db.run(`INSERT OR IGNORE INTO users (id, username, cedula, password, role) VALUES (1, 'admin', 'V-00000000', 'admin123', 'Administrador')`);
  });

  db.run(`CREATE TABLE IF NOT EXISTS directions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL
  )`, () => {
    db.get(`SELECT COUNT(*) as count FROM directions`, (err, row) => {
      if (row && row.count === 0) {
        const defaultDirs = [
          'Dirección Ejecutiva',
          'Dirección de Tecnologías',
          'Unidad de Telemática',
          'Laboratorio de Fotónica'
        ];
        const stmt = db.prepare(`INSERT INTO directions (name) VALUES (?)`);
        defaultDirs.forEach(dir => stmt.run(dir));
        stmt.finalize();
      }
    });
  });

  db.run(`CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    direction_id INTEGER,
    description TEXT NOT NULL,
    national_asset_number TEXT,
    unit_type TEXT NOT NULL DEFAULT 'unidades', 
    quantity REAL NOT NULL,
    FOREIGN KEY(direction_id) REFERENCES directions(id) ON DELETE SET NULL
  )`);

  // Tabla de Préstamos con soporte garantizado para fechas y estatus de retorno
  db.run(`CREATE TABLE IF NOT EXISTS loans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER,
    source_direction_id INTEGER,
    target_direction_id INTEGER,
    sender_responsible TEXT NOT NULL,
    receiver_responsible TEXT NOT NULL,
    quantity REAL NOT NULL,
    return_date TEXT,
    is_returnable TEXT NOT NULL DEFAULT 'SI',
    status TEXT DEFAULT 'ACTIVO',
    date TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(item_id) REFERENCES items(id),
    FOREIGN KEY(source_direction_id) REFERENCES directions(id),
    FOREIGN KEY(target_direction_id) REFERENCES directions(id)
  )`, () => {
    db.run(`ALTER TABLE loans ADD COLUMN return_date TEXT`, (err) => {});
    db.run(`ALTER TABLE loans ADD COLUMN is_returnable TEXT DEFAULT 'SI'`, (err) => {});
  });
});

module.exports = db;