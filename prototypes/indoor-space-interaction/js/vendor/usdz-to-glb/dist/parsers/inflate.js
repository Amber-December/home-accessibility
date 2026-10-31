"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.inflateRaw = inflateRaw;
/**
 * Minimal DEFLATE raw-inflate using Node.js built-in zlib.
 * Only used for ZIP entries that use method=8 (DEFLATED).
 * USDC sections use LZ4, not DEFLATE.
 */
const zlib_1 = require("./zlib-shim");
function inflateRaw(compressed, _expectedSize) {
    return (0, zlib_1.inflateRawSync)(compressed);
}
//# sourceMappingURL=inflate.js.map