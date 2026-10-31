"use strict";
/**
 * USDA (USD ASCII) parser.
 *
 * Parses the text-based USD format into a UsdScene.
 * Supports the subset of USDA features needed for geometry + materials:
 *  - def Mesh, def Scope, def Material, def Shader prims
 *  - point3f[], normal3f[], texCoord2f[], int[], float3f attributes
 *  - xformOp:translate / xformOp:scale / xformOp:transform
 *  - material:binding relationships
 *  - UsdPreviewSurface shader inputs (diffuseColor, roughness, metallic)
 *  - Nested prim hierarchies
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseUSDA = parseUSDA;
const usd_types_1 = require("./usd-types");
function tokenize(src) {
    const tokens = [];
    let i = 0;
    let line = 1;
    while (i < src.length) {
        if (/\s/.test(src[i])) {
            if (src[i] === "\n")
                line++;
            i++;
            continue;
        }
        if (src[i] === "#") {
            while (i < src.length && src[i] !== "\n")
                i++;
            continue;
        }
        if (src[i] === "<") {
            let j = i + 1;
            while (j < src.length && src[j] !== ">")
                j++;
            tokens.push({ kind: "PATH", value: src.slice(i + 1, j), line });
            i = j + 1;
            continue;
        }
        if (src[i] === '"') {
            let j = i + 1;
            let s = "";
            while (j < src.length && src[j] !== '"') {
                if (src[j] === "\\") {
                    j++;
                    s += src[j];
                }
                else {
                    s += src[j];
                }
                j++;
            }
            tokens.push({ kind: "STRING", value: s, line });
            i = j + 1;
            continue;
        }
        if (src[i] === "@") {
            let j = i + 1;
            while (j < src.length && src[j] !== "@")
                j++;
            tokens.push({ kind: "AT", value: src.slice(i + 1, j), line });
            i = j + 1;
            continue;
        }
        if (/[-\d]/.test(src[i]) && (src[i] !== "-" || /\d/.test(src[i + 1] ?? ""))) {
            let j = i;
            if (src[j] === "-")
                j++;
            while (j < src.length && /[\d.eE+\-]/.test(src[j]))
                j++;
            tokens.push({ kind: "NUMBER", value: src.slice(i, j), line });
            i = j;
            continue;
        }
        const singles = {
            "{": "LBRACE", "}": "RBRACE",
            "(": "LPAREN", ")": "RPAREN",
            "[": "LBRACKET", "]": "RBRACKET",
            "=": "EQUALS", ",": "COMMA",
            ".": "DOT", ":": "COLON",
        };
        if (singles[src[i]]) {
            tokens.push({ kind: singles[src[i]], value: src[i], line });
            i++;
            continue;
        }
        if (/[a-zA-Z_]/.test(src[i])) {
            let j = i;
            while (j < src.length && /[a-zA-Z0-9_\-]/.test(src[j]))
                j++;
            tokens.push({ kind: "IDENT", value: src.slice(i, j), line });
            i = j;
            continue;
        }
        i++;
    }
    tokens.push({ kind: "EOF", value: "", line });
    return tokens;
}
// ─── Parser ───────────────────────────────────────────────────────────────────
class Parser {
    constructor(tokens) {
        this.tokens = tokens;
        this.pos = 0;
    }
    peek() { return this.tokens[this.pos]; }
    next() { return this.tokens[this.pos++]; }
    expect(kind) {
        const t = this.next();
        if (t.kind !== kind)
            throw new Error(`USDA line ${t.line}: expected ${kind}, got ${t.kind} "${t.value}"`);
        return t;
    }
    check(kind, value) {
        const t = this.peek();
        return t.kind === kind && (value === undefined || t.value === value);
    }
    eat(kind, value) {
        if (this.check(kind, value)) {
            this.next();
            return true;
        }
        return false;
    }
    readTypeName() {
        if (this.peek().kind !== "IDENT")
            return "";
        let name = this.next().value;
        if (this.peek().kind === "LBRACKET" && this.tokens[this.pos + 1]?.kind === "RBRACKET") {
            this.next();
            this.next(); // consume []
            name += "[]";
        }
        return name;
    }
    readAttrName() {
        let name = this.expect("IDENT").value;
        while (this.eat("COLON"))
            name += ":" + this.expect("IDENT").value;
        return name;
    }
    readNumber() {
        const t = this.next();
        if (t.kind !== "NUMBER")
            throw new Error(`USDA line ${t.line}: expected number`);
        return parseFloat(t.value);
    }
    readVec2() {
        this.expect("LPAREN");
        const x = this.readNumber();
        this.eat("COMMA");
        const y = this.readNumber();
        this.expect("RPAREN");
        return [x, y];
    }
    readVec3() {
        this.expect("LPAREN");
        const x = this.readNumber();
        this.eat("COMMA");
        const y = this.readNumber();
        this.eat("COMMA");
        const z = this.readNumber();
        this.expect("RPAREN");
        return [x, y, z];
    }
    readVec4() {
        this.expect("LPAREN");
        const x = this.readNumber();
        this.eat("COMMA");
        const y = this.readNumber();
        this.eat("COMMA");
        const z = this.readNumber();
        this.eat("COMMA");
        const w = this.readNumber();
        this.expect("RPAREN");
        return [x, y, z, w];
    }
    readArray(readItem) {
        this.expect("LBRACKET");
        const items = [];
        while (!this.check("RBRACKET") && !this.check("EOF")) {
            items.push(readItem());
            this.eat("COMMA");
        }
        this.expect("RBRACKET");
        return items;
    }
    readMatrix4d() {
        this.expect("LPAREN");
        const rows = [];
        for (let i = 0; i < 4; i++) {
            rows.push(this.readVec4());
            this.eat("COMMA");
        }
        this.expect("RPAREN");
        return [
            rows[0][0], rows[0][1], rows[0][2], rows[0][3],
            rows[1][0], rows[1][1], rows[1][2], rows[1][3],
            rows[2][0], rows[2][1], rows[2][2], rows[2][3],
            rows[3][0], rows[3][1], rows[3][2], rows[3][3],
        ];
    }
    skipBlock() {
        this.expect("LBRACE");
        let depth = 1;
        while (depth > 0 && !this.check("EOF")) {
            const k = this.next().kind;
            if (k === "LBRACE")
                depth++;
            else if (k === "RBRACE")
                depth--;
        }
    }
    skipParens() {
        this.expect("LPAREN");
        let depth = 1;
        while (depth > 0 && !this.check("EOF")) {
            const k = this.next().kind;
            if (k === "LPAREN")
                depth++;
            else if (k === "RPAREN")
                depth--;
        }
    }
}
function parsePrim(p, parentPath) {
    const specifier = p.next().value;
    void specifier;
    let typeName = "";
    if (p.peek().kind === "IDENT" && p.tokens[p["pos"] + 1]?.kind !== "EQUALS") {
        typeName = p.next().value;
    }
    const nameToken = p.peek();
    const name = nameToken.kind === "STRING" ? p.next().value : (p.peek().kind === "IDENT" ? p.next().value : "");
    const path = parentPath === "/" ? `/${name}` : `${parentPath}/${name}`;
    const attrs = new Map();
    const children = [];
    if (p.check("LPAREN"))
        p.skipParens();
    if (!p.check("LBRACE")) {
        return { type: typeName, name, path, attrs, children };
    }
    p.expect("LBRACE");
    while (!p.check("RBRACE") && !p.check("EOF")) {
        if (p.check("IDENT", "def") || p.check("IDENT", "over") || p.check("IDENT", "class")) {
            children.push(parsePrim(p, path));
            continue;
        }
        parseAttr(p, attrs);
    }
    p.expect("RBRACE");
    return { type: typeName, name, path, attrs, children };
}
function parseAttr(p, attrs) {
    // Examples:
    //   point3f[] points = [(...)...]
    //   uniform token subdivisionScheme = "none"
    //   rel material:binding = </path>
    //   int[] primvars:st:indices.timeSamples = {...}
    if (p.peek().kind !== "IDENT") {
        p.next();
        return;
    }
    // Modifiers: uniform, varying, custom, prepend, append, delete
    const modifiers = new Set(["uniform", "varying", "custom", "prepend", "append", "delete"]);
    while (modifiers.has(p.peek().value))
        p.next();
    const typeTok = p.peek();
    if (typeTok.kind !== "IDENT") {
        p.next();
        return;
    }
    const typeName = p.readTypeName();
    const attrName = p.readAttrName();
    let suffix = "";
    if (p.check("DOT")) {
        p.next();
        suffix = "." + p.expect("IDENT").value;
    }
    if (!p.eat("EQUALS")) {
        if (p.check("LPAREN"))
            p.skipParens();
        return;
    }
    if (suffix === ".timeSamples") {
        p.skipBlock();
        return;
    }
    const value = parseValue(p, typeName);
    attrs.set(attrName + suffix, value);
    if (p.check("LPAREN"))
        p.skipParens();
}
function parseValue(p, typeName) {
    const t = p.peek();
    // None
    if (t.kind === "IDENT" && t.value === "None") {
        p.next();
        return null;
    }
    // Path
    if (t.kind === "PATH") {
        p.next();
        return "<" + t.value + ">";
    }
    // String / token
    if (t.kind === "STRING") {
        p.next();
        return t.value;
    }
    // Boolean
    if (t.kind === "IDENT" && (t.value === "true" || t.value === "false")) {
        return p.next().value === "true";
    }
    // Asset ref
    if (t.kind === "AT") {
        p.next();
        return "@" + t.value + "@";
    }
    // Arrays  [...]
    if (t.kind === "LBRACKET") {
        if (typeName.includes("point3f") || typeName.includes("normal3f") ||
            typeName.includes("vector3f") || typeName.includes("color3f")) {
            return p.readArray(() => p.readVec3());
        }
        if (typeName.includes("texCoord2f") || typeName.includes("float2")) {
            return p.readArray(() => p.readVec2());
        }
        if (typeName.includes("float4") || typeName.includes("color4f")) {
            return p.readArray(() => p.readVec4());
        }
        if (typeName.includes("int") || typeName.includes("uint")) {
            return p.readArray(() => p.readNumber());
        }
        if (typeName.includes("float") || typeName.includes("double") || typeName.includes("half")) {
            return p.readArray(() => p.readNumber());
        }
        if (typeName.includes("token") || typeName.includes("string") || typeName.includes("asset")) {
            return p.readArray(() => {
                const tok = p.next();
                return tok.kind === "STRING" ? tok.value : tok.value;
            });
        }
        p.next();
        const items = [];
        while (!p.check("RBRACKET") && !p.check("EOF")) {
            items.push(parseValue(p, typeName.replace("[]", "")));
            p.eat("COMMA");
        }
        p.expect("RBRACKET");
        return items;
    }
    // Tuples (x, y) / (x, y, z) / 4×4 matrix
    if (t.kind === "LPAREN") {
        if (typeName === "matrix4d" || typeName === "matrix4f") {
            return p.readMatrix4d();
        }
        if (typeName.includes("3") || typeName === "point3f" || typeName === "normal3f" ||
            typeName === "color3f" || typeName === "vector3f" || typeName === "float3") {
            return p.readVec3();
        }
        if (typeName.includes("2") || typeName === "texCoord2f")
            return p.readVec2();
        if (typeName.includes("4"))
            return p.readVec4();
        return p.readVec4();
    }
    if (t.kind === "NUMBER")
        return p.readNumber();
    p.next();
    return undefined;
}
// ─── Scene builder ────────────────────────────────────────────────────────────
function buildScene(prims, assets) {
    const meshes = [];
    const materials = new Map();
    function collectMaterials(prim) {
        if (prim.type === "Material") {
            const mat = buildMaterial(prim);
            materials.set(prim.path, mat);
        }
        for (const child of prim.children)
            collectMaterials(child);
    }
    function collectMeshes(prim, parentTransform) {
        const localTransform = extractTransform(prim);
        const worldTransform = composeTransforms(parentTransform, localTransform);
        if (prim.type === "Mesh") {
            const mesh = buildMesh(prim, worldTransform);
            if (mesh)
                meshes.push(mesh);
        }
        for (const child of prim.children) {
            collectMeshes(child, worldTransform);
        }
    }
    for (const prim of prims)
        collectMaterials(prim);
    for (const prim of prims)
        collectMeshes(prim, (0, usd_types_1.identityMat4)());
    return {
        format: "usda",
        upAxis: "Y",
        metersPerUnit: 1.0,
        meshes,
        materials,
        textures: assets,
    };
}
function extractTransform(prim) {
    const t = (0, usd_types_1.identityMat4)();
    const xformMatrix = prim.attrs.get("xformOp:transform");
    if (xformMatrix)
        return xformMatrix;
    const translate = prim.attrs.get("xformOp:translate");
    if (translate) {
        t[12] = translate[0];
        t[13] = translate[1];
        t[14] = translate[2];
    }
    return t;
}
function composeTransforms(parent, local) {
    const out = (0, usd_types_1.identityMat4)();
    for (let col = 0; col < 4; col++) {
        for (let row = 0; row < 4; row++) {
            let sum = 0;
            for (let k = 0; k < 4; k++)
                sum += parent[k * 4 + row] * local[col * 4 + k];
            out[col * 4 + row] = sum;
        }
    }
    return out;
}
function buildMesh(prim, transform) {
    const rawPoints = prim.attrs.get("points");
    const rawCounts = prim.attrs.get("faceVertexCounts");
    const rawIndices = prim.attrs.get("faceVertexIndices");
    if (!rawPoints || !rawCounts || !rawIndices)
        return null;
    const points = new Float32Array(rawPoints.flatMap(v => v));
    const faceVertexCounts = new Int32Array(rawCounts);
    const faceVertexIndices = new Int32Array(rawIndices);
    let normals;
    const rawNormals = (prim.attrs.get("normals") ?? prim.attrs.get("primvars:normals"));
    if (rawNormals)
        normals = new Float32Array(rawNormals.flatMap(v => v));
    let uvs;
    let uvIndices;
    const rawUVs = (prim.attrs.get("primvars:st") ?? prim.attrs.get("primvars:uv"));
    if (rawUVs) {
        uvs = new Float32Array(rawUVs.flatMap(v => v));
        const rawUVIdx = prim.attrs.get("primvars:st:indices");
        if (rawUVIdx)
            uvIndices = new Int32Array(rawUVIdx);
    }
    const binding = prim.attrs.get("material:binding");
    const materialPath = binding?.replace(/^<|>$/g, "");
    return {
        name: prim.name,
        transform,
        points,
        faceVertexCounts,
        faceVertexIndices,
        normals,
        uvs,
        uvIndices,
        materialPath,
    };
}
function buildMaterial(prim) {
    let baseColor = { x: 0.8, y: 0.8, z: 0.8, w: 1.0 };
    let metallic = 0.0;
    let roughness = 0.5;
    let diffuseTexturePath;
    function findShaders(p) {
        if (p.type === "Shader") {
            const infoId = p.attrs.get("info:id");
            if (infoId === "UsdPreviewSurface") {
                const dc = p.attrs.get("inputs:diffuseColor");
                if (dc)
                    baseColor = { x: dc[0], y: dc[1], z: dc[2], w: 1.0 };
                const m = p.attrs.get("inputs:metallic");
                if (m !== undefined)
                    metallic = m;
                const r = p.attrs.get("inputs:roughness");
                if (r !== undefined)
                    roughness = r;
            }
            if (infoId === "UsdUVTexture") {
                const file = p.attrs.get("inputs:file");
                if (file)
                    diffuseTexturePath = file.replace(/^@|@$/g, "");
            }
        }
        for (const child of p.children)
            findShaders(child);
    }
    findShaders(prim);
    return {
        name: prim.name,
        primPath: prim.path,
        baseColor,
        metallic,
        roughness,
        diffuseTexturePath,
    };
}
// ─── Public API ───────────────────────────────────────────────────────────────
function parseUSDA(text, assets) {
    const tokens = tokenize(text);
    const p = new Parser(tokens);
    while (p.peek().kind === "HASH") {
        while (p.peek().kind !== "EOF" && p.peek().kind !== "IDENT")
            p.next();
    }
    if (p.check("IDENT", "usda") || p.check("IDENT", "#usda")) {
        p.next(); // "usda"
        if (p.check("NUMBER"))
            p.next(); // "1.0"
    }
    if (p.check("LPAREN"))
        p.skipParens();
    const prims = [];
    while (!p.check("EOF")) {
        if (p.check("IDENT", "def") || p.check("IDENT", "over") || p.check("IDENT", "class")) {
            prims.push(parsePrim(p, ""));
        }
        else {
            p.next();
        }
    }
    return buildScene(prims, assets);
}
//# sourceMappingURL=usda.js.map