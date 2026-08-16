const express = require('express');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const pino = require('pino');

const {
    default: makeWASocket,
    useMultiFileAuthState,
    Browsers,
    delay
} = require('@whiskeysockets/baileys');

const {
    makeid,
    createBase64Session
} = require('./id');

const router = express.Router();

const TEMP_ROOT = path.join(__dirname, '.temp');

fs.mkdirSync(TEMP_ROOT, {
    recursive: true
});

function removeFile(filePath) {
    try {
        fs.rmSync(filePath, {
            recursive: true,
            force: true
        });
    } catch (error) {
        console.error(
            '[QR] Temporary file cleanup failed:',
            error.message
        );
    }
}

router.get('/', async (req, res) => {

    const id = makeid();

    const sessionDir = path.join(
        TEMP_ROOT,
        id
    );

    let socket;

    let qrSent = false;
    let connectionOpened = false;

    async function startQRSession() {

        try {

            fs.mkdirSync(sessionDir, {
                recursive: true
            });

            const {
                state,
                saveCreds
            } = await useMultiFileAuthState(
                sessionDir
            );

            socket = makeWASocket({

                auth: state,

                printQRInTerminal: false,

                logger: pino({
                    level: 'silent'
                }),

                browser: Browsers.macOS('Desktop'),

                markOnlineOnConnect: false,

                syncFullHistory: false
            });

            /*
             * Save authentication changes.
             */
            socket.ev.on(
                'creds.update',
                saveCreds
            );

            /*
             * WhatsApp connection events.
             */
            socket.ev.on(
                'connection.update',
                async (update) => {

                    const {
                        connection,
                        lastDisconnect,
                        qr
                    } = update;

                    /*
                     * New QR code generated.
                     */
                    if (qr && !qrSent) {

                        try {

                            const qrBuffer =
                                await QRCode.toBuffer(qr, {
                                    type: 'png',
                                    width: 512,
                                    margin: 2
                                });

                            if (!res.headersSent) {

                                res.setHeader(
                                    'Content-Type',
                                    'image/png'
                                );

                                res.setHeader(
                                    'Cache-Control',
                                    'no-store, no-cache, must-revalidate'
                                );

                                res.end(qrBuffer);

                                qrSent = true;
                            }

                        } catch (error) {

                            console.error(
                                '[QR] QR generation failed:',
                                error
                            );

                            if (!res.headersSent) {

                                res.status(500).json({
                                    error:
                                        'Unable to generate QR code.'
                                });
                            }
                        }
                    }

                    /*
                     * WhatsApp successfully connected.
                     */
                    if (
                        connection === 'open' &&
                        !connectionOpened
                    ) {

                        connectionOpened = true;

                        try {

                            console.log(
                                `[QR] WhatsApp connected: ${id}`
                            );

                            /*
                             * Allow the final authentication
                             * state to be written to disk.
                             */
                            await delay(3000);

                            /*
                             * Convert the COMPLETE multi-file
                             * authentication state into Base64.
                             */
                            const sessionText =
                                await createBase64Session(
                                    sessionDir
                                );

                            const jid =
                                socket.user?.id;

                            if (!jid) {

                                throw new Error(
                                    'WhatsApp user JID unavailable after connection.'
                                );
                            }

                            const message = `
╔════════════════════◇
║ 『 SESSION CONNECTED 』
║ ⚡ LMK-AGENT002-MD ⚡
╚════════════════════╝

Your Base64 SESSION_ID:

${sessionText}

━━━━━━━━━━━━━━━━━━━━

Keep this SESSION_ID private.

Anyone who obtains it may be able
to authenticate the bot.

Paste it into the bot's SESSION_ID
environment variable.

━━━━━━━━━━━━━━━━━━━━

✅ WhatsApp device linked
✅ Authentication saved
✅ Base64 session generated
`;

                            /*
                             * Send the Base64 session directly
                             * to the newly linked WhatsApp account.
                             */
                            await socket.sendMessage(
                                jid,
                                {
                                    text: message
                                }
                            );

                            console.log(
                                `[QR] Base64 session sent successfully: ${id}`
                            );

                        } catch (error) {

                            console.error(
                                '[QR] Session generation failed:',
                                error
                            );

                        } finally {

                            /*
                             * Give WhatsApp time to send the
                             * session message before cleanup.
                             */
                            setTimeout(() => {

                                try {

                                    if (socket) {
                                        socket.end();
                                    }

                                } catch {}

                                removeFile(
                                    sessionDir
                                );

                                console.log(
                                    `[QR] Temporary authentication removed: ${id}`
                                );

                            }, 3000);
                        }
                    }

                    /*
                     * Connection closed.
                     */
                    if (
                        connection === 'close'
                    ) {

                        const statusCode =
                            lastDisconnect
                                ?.error
                                ?.output
                                ?.statusCode;

                        console.error(
                            `[QR] Connection closed: ${
                                statusCode || 'unknown'
                            }`
                        );

                        /*
                         * If authentication was never
                         * completed, remove the temporary
                         * session.
                         */
                        if (!connectionOpened) {

                            removeFile(
                                sessionDir
                            );
                        }
                    }
                }
            );

        } catch (error) {

            console.error(
                '[QR] QR session failed:',
                error
            );

            removeFile(
                sessionDir
            );

            if (!res.headersSent) {

                res.status(500).json({
                    error:
                        'QR pairing service is currently unavailable.'
                });
            }
        }
    }

    return startQRSession();
});

module.exports = router;
