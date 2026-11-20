/**
 * backend/src/parsers/index.js
 * 
 * Dispatcher parser marketplace terpusat
 */

const { parseShopee } = require('./shopee-parser.js');
const { parseTokopedia } = require('./tokopedia-parser.js');
const { parseLazada } = require('./lazada-parser.js');
const { parseBlibli } = require('./blibli-parser.js');

const parsers = {
    shopee: parseShopee,
    tokopedia: parseTokopedia,
    lazada: parseLazada,
    blibli: parseBlibli
};

/**
 * Mendapatkan parser function berdasarkan id marketplace
 * @param {string} marketplace 
 * @returns {Function}
 */
function getParser(marketplace) {
    const key = (marketplace || '').toLowerCase();
    if (parsers[key]) {
        return parsers[key];
    }
    // Default fallback ke Shopee parser
    return parseShopee;
}

module.exports = {
    getParser,
    parseShopee,
    parseTokopedia,
    parseLazada,
    parseBlibli
};
