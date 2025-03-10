import {type AddressInfo} from 'node:net';
import http from 'node:http';
import path from 'node:path';
import {Buffer} from 'node:buffer';
import {promises as fs} from 'node:fs';
import {marked} from 'marked';
import mime from 'mime';
import escape from 'escape-html';
import enableDestroy from 'server-destroy';

export type WebServerOptions = {
	// The local path that should be mounted as a static web server
	root: string;
	// The port on which to start the local web server
	port?: number;
	// If markdown should be automatically compiled and served
	markdown?: boolean;
	// Should directories automatically serve an inde page
	directoryListing?: boolean;
};

/**
 * Spin up a local HTTP server to serve static requests from disk
 * @private
 * @returns Promise that resolves with the instance of the HTTP server
 */
export async function startWebServer(options: WebServerOptions) {
	const root = path.resolve(options.root);
	return new Promise<http.Server>((resolve, reject) => {
		const server = http
			.createServer(async (request, response) =>
				handleRequest(request, response, root, options),
			)
			.listen(options.port || 0, () => {
				resolve(server);
			})
			.on('error', reject);
		if (!options.port) {
			const addr = server.address() as AddressInfo;
			options.port = addr.port;
		}

		enableDestroy(server);
	});
}

async function handleRequest(
	request: http.IncomingMessage,
	response: http.ServerResponse,
	root: string,
	options: WebServerOptions,
) {
	const url = new URL(request.url || '/', `http://localhost:${options.port}`);
	const pathParts = url.pathname
		.split('/')
		.filter(Boolean)
		// eslint-disable-next-line unicorn/no-array-callback-reference
		.map(decodeURIComponent);
	const originalPath = path.join(root, ...pathParts);
	if (url.pathname.endsWith('/')) {
		pathParts.push('index.html');
	}

	const localPath = path.join(root, ...pathParts);
	if (!localPath.startsWith(root)) {
		response.writeHead(500);
		response.end();
		return;
	}

	const maybeListing =
		options.directoryListing && localPath.endsWith(`${path.sep}index.html`);

	try {
		const stats = await fs.stat(localPath);
		const isDirectory = stats.isDirectory();
		if (isDirectory) {
			// This means we got a path with no / at the end!
			const document = "<html><body>Redirectin'</body></html>";
			response.statusCode = 301;
			response.setHeader('Content-Type', 'text/html; charset=UTF-8');
			response.setHeader('Content-Length', Buffer.byteLength(document));
			response.setHeader('Location', request.url + '/');
			response.end(document);
			return;
		}
	} catch (error) {
		const error_ = error as Error;
		if (!maybeListing) {
			return404(response, error_);
			return;
		}
	}

	try {
		let data = await fs.readFile(localPath, {encoding: 'utf8'});
		let mimeType = mime.getType(localPath);
		const isMarkdown = request.url?.toLocaleLowerCase().endsWith('.md');
		if (isMarkdown && options.markdown) {
			data = marked(data, {gfm: true});
			mimeType = 'text/html; charset=UTF-8';
		}

		response.setHeader('Content-Type', mimeType!);
		response.setHeader('Content-Length', Buffer.byteLength(data));
		response.writeHead(200);
		response.end(data);
	} catch (error) {
		if (maybeListing) {
			try {
				const files = await fs.readdir(originalPath);
				const fileList = files
					.filter((f) => escape(f))
					.map((f) => `<li><a href="${f}">${f}</a></li>`)
					.join('\r\n');
				const data = `<html><body><ul>${fileList}</ul></body></html>`;
				response.writeHead(200);
				response.end(data);
			} catch (error_) {
				// eslint-disable-next-line @typescript-eslint/naming-convention
				const error__ = error_ as Error;
				return404(response, error__);
			}
		} else {
			const error_ = error as Error;
			return404(response, error_);
		}
	}
}

function return404(response: http.ServerResponse, error: Error) {
	response.writeHead(404);
	response.end(JSON.stringify(error));
}
