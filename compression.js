import { createBrotliCompress, createGzip } from 'node:zlib';

const COMPRESSIBLE_TYPES = /^(text\/|application\/(?:javascript|json|xml|wasm)|image\/svg\+xml)/i;

const parseEncodingPreferences = (header) => String(header || '')
  .toLowerCase()
  .split(',')
  .map((part) => {
    const [name, ...parameters] = part.trim().split(';');
    const quality = parameters.find((parameter) => parameter.trim().startsWith('q='));
    return { name: name.trim(), quality: quality ? Number(quality.split('=')[1]) : 1 };
  })
  .filter(({ name, quality }) => name && Number.isFinite(quality) && quality > 0)
  .sort((left, right) => right.quality - left.quality);

const selectEncoding = (header) => {
  const preferences = parseEncodingPreferences(header);
  const accepts = (name) => preferences.find((preference) => preference.name === name)?.quality || 0;
  const wildcard = accepts('*');

  if (accepts('br') || wildcard) return 'br';
  if (accepts('gzip') || wildcard) return 'gzip';
  return null;
};

export const createCompressionMiddleware = () => (req, res, next) => {
  if (req.method === 'HEAD' || req.headers['x-no-compression']) return next();

  const originalWrite = res.write.bind(res);
  const originalEnd = res.end.bind(res);
  let compressor;
  let started = false;

  const startCompression = () => {
    if (started) return Boolean(compressor);
    started = true;

    const contentType = String(res.getHeader('Content-Type') || '');
    const encoding = res.getHeader('Content-Encoding');
    if (encoding || !COMPRESSIBLE_TYPES.test(contentType)) return false;

    const selectedEncoding = selectEncoding(req.headers['accept-encoding']);
    if (!selectedEncoding) return false;

    compressor = selectedEncoding === 'br'
      ? createBrotliCompress({ params: { 1: 4 } })
      : createGzip({ level: 6 });

    compressor.on('data', (chunk) => originalWrite(chunk));
    compressor.on('end', () => originalEnd());
    res.removeHeader('Content-Length');
    res.setHeader('Content-Encoding', selectedEncoding);
    res.setHeader('Vary', 'Accept-Encoding');
    return true;
  };

  res.write = (chunk, encoding, callback) => {
    if (!startCompression()) return originalWrite(chunk, encoding, callback);
    return compressor.write(chunk, encoding, callback);
  };

  res.end = (chunk, encoding, callback) => {
    if (!startCompression()) return originalEnd(chunk, encoding, callback);
    return compressor.end(chunk, encoding, callback);
  };

  next();
};
