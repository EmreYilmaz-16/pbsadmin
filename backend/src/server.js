require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const apiRoutes = require('./routes/api');

const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json({ limit: '1mb' }));
app.use('/api/v1', apiRoutes);

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ success: false, message: error.message || 'Bilinmeyen sunucu hatası' });
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`PBSSiteAdmin API listening on ${port}`);
});
