const express = require('express');
const path = require('path');

const app = express();

const PORT = Number(process.env.PORT) || 8000;
const HOST = '0.0.0.0';

require('events').EventEmitter.defaultMaxListeners = 500;

/*
 * Built-in Express middleware.
 * No body-parser dependency is required.
 */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/*
 * Authentication routes.
 */
const qrRouter = require('./qr');
const pairingRouter = require('./pair');

app.use('/qr', qrRouter);
app.use('/code', pairingRouter);

/*
 * Health check for Render.
 */
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        service: 'LMK-MD pairing service',
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

/*
 * Pairing page.
 */
app.get('/pair', (req, res) => {
    res.sendFile(
        path.join(__dirname, 'pair.html')
    );
});

/*
 * Main page.
 */
app.get('/', (req, res) => {
    res.sendFile(
        path.join(__dirname, 'main.html')
    );
});

/*
 * Handle unknown routes.
 */
app.use((req, res) => {
    res.status(404).json({
        error: 'Route not found'
    });
});

/*
 * Express error handler.
 */
app.use((err, req, res, next) => {
    console.error(
        '[SERVER ERROR]',
        err
    );

    if (res.headersSent) {
        return next(err);
    }

    res.status(500).json({
        error: 'Internal server error'
    });
});

/*
 * Start server.
 */
const server = app.listen(
    PORT,
    HOST,
    () => {
        console.log('');
        console.log('======================================');
        console.log('       LMK-MD PAIRING SERVICE');
        console.log('======================================');
        console.log(`Server listening on ${HOST}:${PORT}`);
        console.log(`Health: /health`);
        console.log(`QR:     /qr`);
        console.log(`Code:   /code`);
        console.log(`Pair:   /pair`);
        console.log('======================================');
        console.log('');
    }
);

/*
 * Graceful shutdown.
 */
function shutdown(signal) {
    console.log(
        `[SERVER] Received ${signal}. Shutting down...`
    );

    server.close(() => {
        console.log(
            '[SERVER] HTTP server closed.'
        );

        process.exit(0);
    });

    /*
     * Don't hang indefinitely during deployment.
     */
    setTimeout(() => {
        process.exit(1);
    }, 10000).unref();
}

process.on(
    'SIGTERM',
    () => shutdown('SIGTERM')
);

process.on(
    'SIGINT',
    () => shutdown('SIGINT')
);

module.exports = app;
