import type { Request } from 'express';
import { MAX_UPLOAD_BYTES } from './archive';

function extractBoundary(contentType: string): string | null {
	const match = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
	return match ? (match[1] || match[2] || '').trim() : null;
}

function parseContentDisposition(header: string): { name: string; filename: string } {
	const name = /(?:^|;)\s*name="([^"]*)"/i.exec(header)?.[1] || '';
	const filename =
		/filename\*=UTF-8''([^;]+)/i.exec(header)?.[1] ||
		/filename="([^"]*)"/i.exec(header)?.[1] ||
		/filename=([^;]+)/i.exec(header)?.[1] ||
		'';
	return { name, filename: decodeURIComponent(String(filename).trim()) };
}

function extractMultipartFile(buffer: Buffer, boundary: string): { buffer: Buffer; filename: string } {
	const marker = Buffer.from(`--${boundary}`);
	let offset = buffer.indexOf(marker);
	if (offset < 0) {
		throw Object.assign(new Error('Could not parse uploaded file'), { status: 400 });
	}

	while (offset >= 0) {
		const headerStart = offset + marker.length;
		if (buffer[headerStart] === 0x2d && buffer[headerStart + 1] === 0x2d) break; // closing --
		const bodyStart = buffer.indexOf('\r\n\r\n', headerStart);
		if (bodyStart < 0) break;
		const headers = buffer.subarray(headerStart, bodyStart).toString('utf8');
		const next = buffer.indexOf(marker, bodyStart + 4);
		if (next < 0) break;
		const { filename } = parseContentDisposition(headers);
		if (filename) {
			let end = next;
			if (end >= 2 && buffer[end - 2] === 0x0d && buffer[end - 1] === 0x0a) end -= 2;
			return { buffer: Buffer.from(buffer.subarray(bodyStart + 4, end)), filename };
		}
		offset = next;
	}

	throw Object.assign(new Error('Upload is missing a file'), { status: 400 });
}

export async function readUploadBuffer(req: Request, maxBytes = MAX_UPLOAD_BYTES): Promise<{ buffer: Buffer; filename: string }> {
	const contentType = String(req.headers['content-type'] || '');
	const chunks: Buffer[] = [];
	let size = 0;

	for await (const chunk of req) {
		const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		size += buf.length;
		if (size > maxBytes) {
			throw Object.assign(new Error(`Upload is too large (max ${Math.round(maxBytes / 1024 / 1024)} MB)`), {
				status: 413,
			});
		}
		chunks.push(buf);
	}

	const raw = Buffer.concat(chunks);
	if (!raw.length) {
		throw Object.assign(new Error('No file was uploaded'), { status: 400 });
	}

	if (contentType.toLowerCase().includes('multipart/form-data')) {
		const boundary = extractBoundary(contentType);
		if (!boundary) {
			throw Object.assign(new Error('Invalid multipart upload'), { status: 400 });
		}
		return extractMultipartFile(raw, boundary);
	}

	const filename = String(req.headers['x-file-name'] || 'upload.bin');
	return { buffer: raw, filename };
}
