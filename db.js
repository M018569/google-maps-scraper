const fs = require('fs');
const path = require('path');

// Check if running on Replit
const isReplit = !!process.env.REPLIT_DB_URL;

let replitDb = null;
const localDbPath = path.join(__dirname, 'data', 'local-db.json');

// Initialize Replit Database if available
if (isReplit) {
  try {
    const Database = require('@replit/database');
    replitDb = new Database();
    console.log('Using Replit Database');
  } catch (e) {
    console.log('Replit Database not available, falling back to local storage');
  }
}

// Local file-based database for development
class LocalDb {
  constructor() {
    this.data = {};
    this.load();
  }

  load() {
    try {
      // Ensure data directory exists
      const dataDir = path.dirname(localDbPath);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      if (fs.existsSync(localDbPath)) {
        const content = fs.readFileSync(localDbPath, 'utf8');
        this.data = JSON.parse(content);
        console.log('Loaded local database');
      } else {
        this.data = {};
        this.save();
        console.log('Created new local database');
      }
    } catch (error) {
      console.error('Error loading local database:', error);
      this.data = {};
    }
  }

  save() {
    try {
      const dataDir = path.dirname(localDbPath);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      fs.writeFileSync(localDbPath, JSON.stringify(this.data, null, 2));
    } catch (error) {
      console.error('Error saving local database:', error);
    }
  }

  async get(key) {
    return this.data[key] || null;
  }

  async set(key, value) {
    this.data[key] = value;
    this.save();
  }

  async delete(key) {
    delete this.data[key];
    this.save();
  }

  async list(prefix = '') {
    return Object.keys(this.data).filter(key => key.startsWith(prefix));
  }
}

const localDb = new LocalDb();

// Unified database interface
module.exports = {
  async get(key) {
    if (replitDb) {
      return await replitDb.get(key);
    }
    return await localDb.get(key);
  },

  async set(key, value) {
    if (replitDb) {
      return await replitDb.set(key, value);
    }
    return await localDb.set(key, value);
  },

  async delete(key) {
    if (replitDb) {
      return await replitDb.delete(key);
    }
    return await localDb.delete(key);
  },

  async list(prefix = '') {
    if (replitDb) {
      return await replitDb.list(prefix);
    }
    return await localDb.list(prefix);
  }
};
