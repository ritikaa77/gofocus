require('dotenv').config();
const { createApp } = require('./app');
const { migrate } = require('./db');

const PORT = process.env.PORT || 3000;

(async () => {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not set');
  await migrate();
  createApp().listen(PORT, () => console.log(`GoFocus running on http://localhost:${PORT}`));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
