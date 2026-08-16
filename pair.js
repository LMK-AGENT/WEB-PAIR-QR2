const express = require('express');
const fs = require('fs');
const path = require('path');
const pino = require('pino');

const {
    default: makeWASocket,
    useMultiFileAuthState,
    makeCacheableSignalKeyStore,
    Browsers,
    delay
} = require('@whiskeysockets/baileys');

const { makeid, createBase64Session } = require('./id');

const router = express.Router();

const TEMP_ROOT = path.join(__dirname, '.temp');
fs.mkdirSync(TEMP_ROOT, { recursive: true });

function removeFile(filePath) {
    try {
        fs.rmSync(filePath, {
            recursive: true,
            force: true
        });
    } catch (error) {
        console.error('Temporary file cleanup failed:', error.message);
    }
}

function normalizeNumber(value) {
    return String(value || '').replace(/\D/g, '');
}

router.get('/', async (req, res) => {
    const id = makeid();
    const sessionDir = path.join(TEMP_ROOT, id);

    let socket;

    const number = normalizeNumber(req.query.number);

    if (!number || number.length < 7 || number.length > 15) {
        return res.status(400).json({
            error: 'Enter a valid WhatsApp number in international format without +, spaces, or hyphens.'
        });
    }

    try {
        fs.mkdirSync(sessionDir, { recursive: true });

        const {
            state,
            saveCreds
        } = await useMultiFileAuthState(sessionDir);

        socket = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(
                    state.keys,
                    pino({ level: 'silent' })
                )
            },

            printQRInTerminal: false,

            logger: pino({
                level: 'silent'
            }),

            browser: Browsers.macOS('Chrome'),

            markOnlineOnConnect: false,

            syncFullHistory: false
        });

        socket.ev.on('creds.update', saveCreds);

        /*
         * Pairing-code authentication
         */
        if (!state.creds.registered) {
            await delay(1500);

            const code = await socket.requestPairingCode(number);

            if (!res.headersSent) {
                return res.json({
                    success: true,
                    code,
                    message:
                        'Open WhatsApp → Linked Devices → Link with phone number, then enter this code.'
                });
            }
        }

        /*
         * WhatsApp connection state
         */
        socket.ev.on('connection.update', async (update) => {
            const {
                connection,
                lastDisconnect
            } = update;

            /*
             * Authentication succeeded
             */
            if (connection === 'open') {
                try {
                    console.log(`[PAIR] WhatsApp connected: ${id}`);

                    /*
                     * Give Baileys time to finish writing
                     * the authentication state.
                     */
                    await delay(3000);

                    /*
                     * Convert the COMPLETE multi-file
                     * authentication state into Base64.
                     */
                    const sessionText =
                        await createBase64Session(sessionDir);

                    const jid = socket.user?.id;

                    if (jid) {
                        const message = `
╔════════════════════◇
║ 『 SESSION CONNECTED 』
║ ⚡ LMK-AGENT002-MD ⚡
╚════════════════════╝

Your Base64 SESSION_ID:

${sessionText}

━━━━━━━━━━━━━━━━━━━━

Keep this SESSION_ID private.

Anyone who obtains it may be able to
authenticate the bot.

Paste it into the bot's SESSION_ID
environment variable.

━━━━━━━━━━━━━━━━━━━━

✅ WhatsApp device linked
✅ Authentication saved
✅ Base64 session generated
`;

                        await socket.sendMessage(
                            jid,
                            {
                                text: message
                            }
                        );

                        console.log(
                            `[PAIR] Base64 session sent successfully: ${id}`
                        );
                    } else {
                        console.error(
                            `[PAIR] Connected but WhatsApp JID was unavailable: ${id}`
                        );
                    }

                } catch (error) {
                    console.error(
                        '[PAIR] Session generation failed:',
                        error
                    );

                } finally {

                    /*
                     * Give the message time to leave before
                     * destroying the temporary authentication state.
                     */
                    setTimeout(() => {

                        try {
                            if (socket) {
                                socket.end();
                            }
                        } catch {}

                        removeFile(sessionDir);

                        console.log(
                            `[PAIR] Temporary authentication removed: ${id}`
                        );

                    }, 3000);
                }
            }

            /*
             * Connection closed
             */
            if (connection === 'close') {

                const statusCode =
                    lastDisconnect?.error?.output?.statusCode;

                console.error(
                    `[PAIR] WhatsApp connection closed: ${statusCode || 'unknown'}`
                );

                /*
                 * Only clean up here if authentication did not
                 * successfully finish.
                 */
                removeFile(sessionDir);
            }
        });

    } catch (error) {

        console.error(
            '[PAIR] Pairing request failed:',
            error
        );

        removeFile(sessionDir);

        if (!res.headersSent) {
            return res.status(500).json({
                error: 'Pairing service is currently unavailable.'
            });
        }
    }
});

module.exports = router;
