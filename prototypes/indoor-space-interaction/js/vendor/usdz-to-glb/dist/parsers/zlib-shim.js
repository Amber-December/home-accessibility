// Browser DEFLATE shim for the vendored USDZ converter.
function inflateRawSync(data) {
  if (typeof fflate === 'undefined' || typeof fflate.inflateSync !== 'function') {
    throw new Error('USDZ 压缩条目需要 fflate.inflateSync');
  }
  return fflate.inflateSync(data);
}
exports.inflateRawSync = inflateRawSync;
