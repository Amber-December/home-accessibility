"use strict";
/**
 * usdz-to-glb — public API
 *
 * Usage:
 *   import { convertUsdzToGlb } from "usdz-to-glb";
 *   const glb = convertUsdzToGlb(fs.readFileSync("model.usdz"));
 *   fs.writeFileSync("model.glb", glb);
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.convertUsdzToGlb = convertUsdzToGlb;
const usdz_1 = require("./parsers/usdz");
const usda_1 = require("./parsers/usda");
const usdc_1 = require("./parsers/usdc");
const glb_1 = require("./builders/glb");
/**
 * Convert a USDZ buffer to a GLB buffer.
 *
 * @param usdzBuffer - Raw bytes of the .usdz file (a ZIP archive).
 * @returns Raw bytes of the resulting .glb file.
 */
function convertUsdzToGlb(usdzBuffer) {
    const buf = usdzBuffer instanceof Uint8Array ? usdzBuffer : new Uint8Array(usdzBuffer);
    const entries = (0, usdz_1.unpackUSDZ)(buf);
    if (entries.length === 0)
        throw new Error("usdz-to-glb: archive is empty");
    const assets = new Map();
    for (const entry of entries) {
        const ext = entry.filename.split(".").pop()?.toLowerCase();
        if (ext !== "usda" && ext !== "usdc") {
            assets.set(entry.filename, entry.data);
            const base = entry.filename.split("/").pop();
            assets.set(base, entry.data);
        }
    }
    // Parses every USD layer in the archive and merge meshes + materials.
    // This handles RoomPlan-style USDZ files where geometry is split across
    // many referenced sub-layers rather than inlined in the root.
    const merged = {
        format: "usda",
        upAxis: "Y",
        metersPerUnit: 1.0,
        meshes: [],
        materials: new Map(),
        textures: assets,
    };
    for (const entry of entries) {
        const ext = entry.filename.split(".").pop()?.toLowerCase();
        if (ext !== "usda" && ext !== "usdc")
            continue;
        let scene;
        try {
            if (ext === "usda") {
                const text = new TextDecoder().decode(entry.data);
                scene = (0, usda_1.parseUSDA)(text, assets);
            }
            else {
                scene = (0, usdc_1.parseUSDC)(entry.data, assets);
            }
        }
        catch {
            continue;
        }
        for (const mesh of scene.meshes)
            merged.meshes.push(mesh);
        for (const [k, v] of scene.materials)
            merged.materials.set(k, v);
        if (scene.upAxis)
            merged.upAxis = scene.upAxis;
        if (scene.metersPerUnit)
            merged.metersPerUnit = scene.metersPerUnit;
    }
    return (0, glb_1.buildGlb)(merged);
}
//# sourceMappingURL=index.js.map