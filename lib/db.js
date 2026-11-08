const mysql = require("mysql2/promise");
require("dotenv").config();

/**
 * Creates and configures the MySQL connection pool.
 * Abides strictly by SRP: Connection pool lifecycle only.
 */
const pool = mysql.createPool({
  host: process.env.MYSQL_HOST || "127.0.0.1",
  port: Number(process.env.MYSQL_PORT) || 3306,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
  timezone: "+07:00",
  dateStrings: ["DATE"]
});

// Enforce Vietnam timezone on every new physical connection
pool.on("connection", (connection) => {
  connection.query("SET time_zone = '+07:00'");
});

/**
 * Closes the connection pool gracefully on system shutdown.
 * @returns {Promise<void>}
 */
async function closePool() {
  await pool.end();
}

module.exports = {
  pool,
  closePool
};
