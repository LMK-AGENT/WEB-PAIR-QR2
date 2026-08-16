const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Generate a random ID for temporary authentication sessions.
 */
function makeid(length = 8) {
    const characters =
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

    let result = '';

    for (let i = 0; i < length; i++) {
        result += characters.charAt(
            Math.floor(Math.random() * characters.length)
        );
    }

    return result;
}

/**
 * Create a Base64 LMK-MD session from a complete
 * Baileys multi-file authentication directory.
 *
 * The entire auth directory is packaged into one
 * compressed Base64 string so all required credentials
 * and key files can be restored later.
 */
async function createBase64Session(sessionDirectory) {
    if (!sessionDirectory) {
        throw new Error('Session directory is required.');
    }

    const absolutePath = path.resolve(sessionDirectory);

    if (!fs.existsSync(absolutePath)) {
        throw new Error(
            `Session directory does not exist: ${absolutePath}`
        );
    }

    const files = fs.readdirSync(
        absolutePath,
        { withFileTypes: true }
    );

    const sessionFiles = {};

    for (const entry of files) {
        if (!entry.isFile()) {
            continue;
        }

        const filePath = path.join(
            absolutePath,
            entry.name
        );

        const fileData = fs.readFileSync(filePath);

        sessionFiles[entry.name] =
            fileData.toString('base64');
    }

    if (Object.keys(sessionFiles).length === 0) {
        throw new Error(
            'No authentication files were found in the session directory.'
        );
    }

    const payload = {
        version: 1,
        type: 'LMK-MD',
        createdAt: new Date().toISOString(),
        files: sessionFiles
    };

    const json = JSON.stringify(payload);

    /*
     * Compress the JSON before Base64 encoding.
     * This keeps the resulting SESSION_ID smaller.
     */
    const compressed = zlibGzipSync(
        Buffer.from(json, 'utf8')
    );

    return `LMK-MD~${compressed.toString('base64')}`;
}

/**
 * Restore a Base64 LMK-MD session into a directory.
 *
 * This is useful for the bot side when SESSION_ID
 * is supplied through an environment variable.
 */
async function restoreBase64Session(
    sessionText,
    destinationDirectory
) {
    if (!sessionText) {
        throw new Error('SESSION_ID is empty.');
    }

    if (!destinationDirectory) {
        throw new Error(
            'Destination directory is required.'
        );
    }

    let encoded = String(sessionText).trim();

    if (encoded.startsWith('LMK-MD~')) {
        encoded = encoded.slice('LMK-MD~'.length);
    }

    if (!encoded) {
        throw new Error(
            'SESSION_ID does not contain session data.'
        );
    }

    let compressed;

    try {
        compressed = Buffer.from(
            encoded,
            'base64'
        );
    } catch {
        throw new Error(
            'SESSION_ID contains invalid Base64 data.'
        );
    }

    let payload;

    try {
        const json = zlibGunzipSync(
            compressed
        ).toString('utf8');

        payload = JSON.parse(json);
    } catch {
        throw new Error(
            'SESSION_ID could not be decoded or decompressed.'
        );
    }

    if (
        !payload ||
        payload.type !== 'LMK-MD' ||
        !payload.files
    ) {
        throw new Error(
            'Invalid LMK-MD session format.'
        );
    }

    const destination =
        path.resolve(destinationDirectory);

    fs.mkdirSync(destination, {
        recursive: true
    });

    for (
        const [fileName, encodedData]
        of Object.entries(payload.files)
    ) {
        /*
         * Prevent path traversal through malicious
         * filenames inside a session.
         */
        const safeName =
            path.basename(fileName);

        if (safeName !== fileName) {
            continue;
        }

        const filePath =
            path.join(destination, safeName);

        const fileData =
            Buffer.from(
                encodedData,
                'base64'
            );

        fs.writeFileSync(
            filePath,
            fileData
        );
    }

    return destination;
}

/*
 * These wrappers keep zlib isolated and avoid
 * loading anything unrelated to the session system.
 */
function zlibGzipSync(buffer) {
    const zlib = require('zlib');
    return zlib.gzipSync(buffer);
}

function zlibGunzipSync(buffer) {
    const zlib = require('zlib');
    return zlib.gunzipSync(buffer);
}

module.exports = {
    makeid,
    createBase64Session,
    restoreBase64Session
};
