"use strict";
/**
 * Shared USD scene-graph types.
 *
 * minimal types needed to represent USD geometry and materials
 * after parsing either USDA (text) or USDC (binary crate) format.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.identityMat4 = identityMat4;
exports.multiplyMat4 = multiplyMat4;
function identityMat4() {
    return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}
function multiplyMat4(a, b) {
    const out = new Array(16).fill(0);
    for (let row = 0; row < 4; row++) {
        for (let col = 0; col < 4; col++) {
            let sum = 0;
            for (let k = 0; k < 4; k++) {
                sum += a[row + k * 4] * b[k + col * 4];
            }
            out[row + col * 4] = sum;
        }
    }
    return out;
}
//# sourceMappingURL=usd-types.js.map