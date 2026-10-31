"use strict";
/**
 * USDC (USD Crate / PXR-USDC) binary parser.
 *
 * Reads the binary crate format produced by Pixar's USD library and extracts
 * geometry + material data into a UsdScene.
 *
 * Crate file layout:
 *  [0..7]   magic  "PXR-USDC"
 *  [8..15]  version (major, minor, patch, ...)
 *  followed by the section table at a known offset in the TOC
 *
 * Each section is identified by a name token and has a start+size.
 * Sections of interest: TOKENS, STRINGS, FIELDS, FIELDSETS, PATHS, SPECS.
 * Each section may be LZ4-compressed.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseUSDC = parseUSDC;
const usd_types_1 = require("./usd-types");
const lz4_1 = require("../utils/lz4");
// ─── Constants ────────────────────────────────────────────────────────────────
const MAGIC = "PXR-USDC";
// ─── Reader helper ─────────────────────────────────────────────────────────────
class Reader {
    constructor(buf) {
        this.buf = buf;
        this.dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
        this.pos = 0;
    }
    get length() { return this.buf.length; }
    seek(pos) { this.pos = pos; }
    u8() { return this.dv.getUint8(this.pos++); }
    i32() { const v = this.dv.getInt32(this.pos, true); this.pos += 4; return v; }
    u32() { const v = this.dv.getUint32(this.pos, true); this.pos += 4; return v; }
    f32() { const v = this.dv.getFloat32(this.pos, true); this.pos += 4; return v; }
    f64() { const v = this.dv.getFloat64(this.pos, true); this.pos += 8; return v; }
    u64() {
        const lo = this.dv.getUint32(this.pos, true);
        const hi = this.dv.getUint32(this.pos + 4, true);
        this.pos += 8;
        return hi * 0x100000000 + lo;
    }
    varint() {
        let result = 0;
        let shift = 0;
        while (true) {
            const b = this.u8();
            result |= (b & 0x7f) << shift;
            if (!(b & 0x80))
                break;
            shift += 7;
        }
        return result >>> 0;
    }
    bytes(n) {
        const slice = this.buf.subarray(this.pos, this.pos + n);
        this.pos += n;
        return slice;
    }
    string(n) {
        return new TextDecoder().decode(this.bytes(n));
    }
    align(n) {
        const r = this.pos % n;
        if (r)
            this.pos += n - r;
    }
}
function readSections(r) {
    r.seek(r.length - 8);
    const tocOffset = r.u64();
    r.seek(tocOffset);
    const count = r.u64();
    const sections = [];
    for (let i = 0; i < count; i++) {
        const rawName = r.bytes(16);
        const name = new TextDecoder().decode(rawName).replace(/\0.*$/, "");
        const start = r.u64();
        const size = r.u64();
        sections.push({ name, start, size });
    }
    return sections;
}
function getSection(sections, name) {
    return sections.find(s => s.name === name);
}
// ─── Compressed section reader ─────────────────────────────────────────────────
/**
 * Crate sections use a simple framing:
 *   uint64  uncompressed size
 *   uint64  compressed size
 *   [compressed data — LZ4 block]
 * If compressedSize == uncompressedSize the data is stored uncompressed.
 */
function readCompressedSection(r, sec) {
    r.seek(sec.start);
    const uncompSize = r.u64();
    const cmpSize = r.u64();
    const raw = r.bytes(cmpSize);
    if (cmpSize === uncompSize)
        return raw.slice();
    return (0, lz4_1.decompressLZ4)(raw, uncompSize);
}
// ─── TOKENS section ────────────────────────────────────────────────────────────
function readTokens(r, sec) {
    const data = readCompressedSection(r, sec);
    const dr = new Reader(data);
    const count = dr.u64();
    const tokens = [];
    for (let i = 0; i < count; i++) {
        let s = "";
        let b;
        while ((b = dr.u8()) !== 0)
            s += String.fromCharCode(b);
        tokens.push(s);
    }
    return tokens;
}
// ─── STRINGS section ────────────────────────────────────────────────────────────
function readStrings(r, sec, tokens) {
    const data = readCompressedSection(r, sec);
    const dr = new Reader(data);
    const count = dr.u64();
    const strings = [];
    for (let i = 0; i < count; i++) {
        strings.push(tokens[dr.u32()] ?? "");
    }
    return strings;
}
function readFields(r, sec) {
    const data = readCompressedSection(r, sec);
    const dr = new Reader(data);
    const count = dr.u64();
    const fields = [];
    for (let i = 0; i < count; i++) {
        const tokenIndex = dr.u32();
        dr.align(8);
        const lo = dr.u32();
        const hi = dr.u32();
        const rep = hi * 0x100000000 + lo;
        fields.push({ tokenIndex, valueRep: rep });
    }
    return fields;
}
// ─── FIELDSETS section ─────────────────────────────────────────────────────────
function readFieldSets(r, sec) {
    const data = readCompressedSection(r, sec);
    const dr = new Reader(data);
    const count = dr.u64();
    const sets = [];
    let cur = [];
    for (let i = 0; i < count; i++) {
        const idx = dr.u32();
        if (idx === 0xffffffff) {
            sets.push(cur);
            cur = [];
        }
        else {
            cur.push(idx);
        }
    }
    return sets;
}
function readPaths(r, sec, tokens) {
    const data = readCompressedSection(r, sec);
    const dr = new Reader(data);
    const count = dr.u64();
    const nodes = [];
    for (let i = 0; i < count; i++) {
        const tokenIndex = dr.u32();
        const fieldSetIdx = dr.u32();
        const specType = dr.u32();
        const flags = dr.u32();
        const jump = dr.i32();
        nodes.push({
            path: tokens[tokenIndex] ?? "",
            tokenIndex,
            fieldSetIdx,
            specType,
            jump,
            hasChildren: !!(flags & 1),
            hasSiblings: !!(flags & 2),
        });
    }
    return nodes;
}
function readSpecs(r, sec) {
    const data = readCompressedSection(r, sec);
    const dr = new Reader(data);
    const count = dr.u64();
    const specs = [];
    for (let i = 0; i < count; i++) {
        const pathIndex = dr.u32();
        const fieldSetIndex = dr.u32();
        const specType = dr.u32();
        specs.push({ pathIndex, fieldSetIndex, specType });
    }
    return specs;
}
// ─── Value decoding ────────────────────────────────────────────────────────────
/**
 * Decode a USD value representation.
 *
 * The 64-bit valueRep packs:
 *   bits[5:0]   type tag (VT enum)
 *   bit[6]      array flag
 *   bit[7]      inlined flag (small values stored directly)
 *   bits[63:8]  payload (inline value OR byte offset into the file)
 */
function decodeValueRep(rep, r, tokens, strings) {
    const typeTag = rep & 0x3f;
    const isArray = !!(rep & 0x40);
    const inlined = !!(rep & 0x80);
    const payload = Math.floor(rep / 256); // bits 63:8
    if (inlined) {
        return decodeInline(typeTag, payload, tokens, strings);
    }
    const savedPos = r.pos;
    r.seek(payload);
    let value;
    if (isArray) {
        value = decodeArray(typeTag, r, tokens, strings);
    }
    else {
        value = decodeScalar(typeTag, r, tokens, strings);
    }
    r.seek(savedPos);
    return value;
}
function decodeInline(typeTag, payload, tokens, strings) {
    switch (typeTag) {
        case 1 /* VT.bool */: return payload !== 0;
        case 2 /* VT.uchar */: return payload & 0xff;
        case 3 /* VT.int */: return payload | 0;
        case 4 /* VT.uint */: return payload >>> 0;
        case 8 /* VT.float */: {
            const buf = new ArrayBuffer(4);
            new DataView(buf).setUint32(0, payload, true);
            return new DataView(buf).getFloat32(0, true);
        }
        case 9 /* VT.double */: return payload;
        case 11 /* VT.token */: return tokens[payload] ?? "";
        case 10 /* VT.string */: return strings[payload] ?? "";
        case 12 /* VT.asset */: return strings[payload] ?? "";
        default: return payload;
    }
}
function decodeScalar(typeTag, r, tokens, strings) {
    switch (typeTag) {
        case 1 /* VT.bool */: return r.u8() !== 0;
        case 3 /* VT.int */: return r.i32();
        case 4 /* VT.uint */: return r.u32();
        case 8 /* VT.float */: return r.f32();
        case 9 /* VT.double */: return r.f64();
        case 11 /* VT.token */: return tokens[r.u32()] ?? "";
        case 10 /* VT.string */: return strings[r.u32()] ?? "";
        case 12 /* VT.asset */: return strings[r.u32()] ?? "";
        case 20 /* VT.vec2f */: return [r.f32(), r.f32()];
        case 24 /* VT.vec3f */: return [r.f32(), r.f32(), r.f32()];
        case 28 /* VT.vec4f */: return [r.f32(), r.f32(), r.f32(), r.f32()];
        case 19 /* VT.vec2d */: return [r.f64(), r.f64()];
        case 23 /* VT.vec3d */: return [r.f64(), r.f64(), r.f64()];
        case 15 /* VT.matrix4d */: {
            const m = [];
            for (let i = 0; i < 16; i++)
                m.push(r.f64());
            return [
                m[0], m[1], m[2], m[3],
                m[4], m[5], m[6], m[7],
                m[8], m[9], m[10], m[11],
                m[12], m[13], m[14], m[15],
            ];
        }
        default: return undefined;
    }
}
function decodeArray(typeTag, r, tokens, strings) {
    const count = r.u64();
    const items = [];
    for (let i = 0; i < count; i++) {
        items.push(decodeScalar(typeTag, r, tokens, strings));
    }
    return items;
}
function buildPrimTree(specs, pathStrings, fieldSets, fields, tokens, strings, fileReader) {
    const roots = [];
    const stack = [];
    for (const spec of specs) {
        const path = pathStrings[spec.pathIndex] ?? "";
        const attrs = new Map();
        const fieldSet = fieldSets[spec.fieldSetIndex] ?? [];
        for (const fi of fieldSet) {
            const field = fields[fi];
            if (!field)
                continue;
            const attrName = tokens[field.tokenIndex] ?? "";
            const value = decodeValueRep(field.valueRep, fileReader, tokens, strings);
            attrs.set(attrName, value);
        }
        const prim = { path, specType: spec.specType, attrs, children: [] };
        const depth = path.split("/").filter(Boolean).length;
        while (stack.length >= depth)
            stack.pop();
        if (stack.length > 0) {
            stack[stack.length - 1].children.push(prim);
        }
        else {
            roots.push(prim);
        }
        stack.push(prim);
    }
    return roots;
}
// ─── Scene extraction ──────────────────────────────────────────────────────────
function extractScene(prims, assets) {
    const meshes = [];
    const materials = new Map();
    function walkMaterials(p) {
        const typeName = p.attrs.get("typeName") ?? "";
        if (typeName === "Material" || p.path.toLowerCase().includes("material")) {
            const mat = extractMaterial(p);
            if (mat)
                materials.set(p.path, mat);
        }
        for (const c of p.children)
            walkMaterials(c);
    }
    function walkMeshes(p, parentTransform) {
        const typeName = p.attrs.get("typeName") ?? "";
        const localXform = extractTransform(p);
        const world = multiplyMat4(parentTransform, localXform);
        if (typeName === "Mesh") {
            const mesh = extractMesh(p, world);
            if (mesh)
                meshes.push(mesh);
        }
        for (const c of p.children)
            walkMeshes(c, world);
    }
    for (const p of prims)
        walkMaterials(p);
    for (const p of prims)
        walkMeshes(p, (0, usd_types_1.identityMat4)());
    return { format: "usdc", upAxis: "Y", metersPerUnit: 1.0, meshes, materials, textures: assets };
}
function multiplyMat4(a, b) {
    const out = (0, usd_types_1.identityMat4)();
    for (let col = 0; col < 4; col++) {
        for (let row = 0; row < 4; row++) {
            let s = 0;
            for (let k = 0; k < 4; k++)
                s += a[k * 4 + row] * b[col * 4 + k];
            out[col * 4 + row] = s;
        }
    }
    return out;
}
function extractTransform(p) {
    const m = p.attrs.get("xformOp:transform");
    if (m)
        return m;
    const t = (0, usd_types_1.identityMat4)();
    const tr = p.attrs.get("xformOp:translate");
    if (tr) {
        t[12] = tr[0];
        t[13] = tr[1];
        t[14] = tr[2];
    }
    return t;
}
function extractMesh(p, transform) {
    const rawPoints = p.attrs.get("points");
    const rawCounts = p.attrs.get("faceVertexCounts");
    const rawIndices = p.attrs.get("faceVertexIndices");
    if (!rawPoints || !rawCounts || !rawIndices)
        return null;
    const points = new Float32Array(rawPoints.flatMap(v => v));
    const faceVertexCounts = new Int32Array(rawCounts);
    const faceVertexIndices = new Int32Array(rawIndices);
    let normals;
    const rawN = (p.attrs.get("normals") ?? p.attrs.get("primvars:normals"));
    if (rawN)
        normals = new Float32Array(rawN.flatMap(v => v));
    let uvs;
    let uvIndices;
    const rawUV = (p.attrs.get("primvars:st") ?? p.attrs.get("primvars:uv"));
    if (rawUV) {
        uvs = new Float32Array(rawUV.flatMap(v => v));
        const rawUVIdx = p.attrs.get("primvars:st:indices");
        if (rawUVIdx)
            uvIndices = new Int32Array(rawUVIdx);
    }
    const binding = p.attrs.get("material:binding");
    const materialPath = binding?.replace(/^<|>$/g, "");
    const name = p.path.split("/").pop() ?? "mesh";
    return { name, transform, points, faceVertexCounts, faceVertexIndices, normals, uvs, uvIndices, materialPath };
}
function extractMaterial(p) {
    let baseColor = { x: 0.8, y: 0.8, z: 0.8, w: 1.0 };
    let metallic = 0.0;
    let roughness = 0.5;
    let diffuseTexturePath;
    function walkShaders(s) {
        const id = s.attrs.get("info:id");
        if (id === "UsdPreviewSurface") {
            const dc = s.attrs.get("inputs:diffuseColor");
            if (dc)
                baseColor = { x: dc[0], y: dc[1], z: dc[2], w: 1.0 };
            const m = s.attrs.get("inputs:metallic");
            if (m !== undefined)
                metallic = m;
            const rr = s.attrs.get("inputs:roughness");
            if (rr !== undefined)
                roughness = rr;
        }
        if (id === "UsdUVTexture") {
            const file = s.attrs.get("inputs:file");
            if (file)
                diffuseTexturePath = file.replace(/^@|@$/g, "");
        }
        for (const c of s.children)
            walkShaders(c);
    }
    walkShaders(p);
    const name = p.path.split("/").pop() ?? "material";
    return { name, primPath: p.path, baseColor, metallic, roughness, diffuseTexturePath };
}
// ─── Public API ────────────────────────────────────────────────────────────────
function parseUSDC(buffer, assets) {
    if (buffer.length < 8)
        throw new Error("USDC: file too small");
    const magic = new TextDecoder().decode(buffer.subarray(0, 8));
    if (magic !== MAGIC)
        throw new Error(`USDC: bad magic "${magic}" — expected "${MAGIC}"`);
    const r = new Reader(buffer);
    const sections = readSections(r);
    const tokenSec = getSection(sections, "TOKENS");
    const stringSec = getSection(sections, "STRINGS");
    const fieldSec = getSection(sections, "FIELDS");
    const fieldSetSec = getSection(sections, "FIELDSETS");
    const specSec = getSection(sections, "SPECS");
    const pathSec = getSection(sections, "PATHS");
    if (!tokenSec || !fieldSec || !fieldSetSec || !specSec || !pathSec) {
        throw new Error("USDC: missing required section(s) — file may be corrupt or unsupported version");
    }
    const tokens = readTokens(r, tokenSec);
    const strings = stringSec ? readStrings(r, stringSec, tokens) : [];
    const fields = readFields(r, fieldSec);
    const fieldSets = readFieldSets(r, fieldSetSec);
    const specs = readSpecs(r, specSec);
    const paths = readPaths(r, pathSec, tokens);
    const pathStrings = paths.map(p => p.path);
    const prims = buildPrimTree(specs, pathStrings, fieldSets, fields, tokens, strings, r);
    return extractScene(prims, assets);
}
//# sourceMappingURL=usdc.js.map