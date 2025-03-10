import {promises as fs} from 'node:fs';
import process from 'node:process';
import path from 'node:path';

export type Flags = {
	concurrency?: number;
	config?: string;
	recurse?: boolean;
	skip?: string | string[];
	format?: string;
	silent?: boolean;
	verbosity?: string;
	timeout?: number;
	markdown?: boolean;
	serverRoot?: string;
	directoryListing?: boolean;
	retry?: boolean;
	retryErrors?: boolean;
	retryErrorsCount?: number;
	retryErrorsJitter?: number;
	urlRewriteSearch?: string;
	urlRewriteReplace?: string;
};

export async function getConfig(flags: Flags) {
	// Check to see if a config file path was passed
	const configPath = flags.config || 'linkinator.config.json';
	let config: Flags = {};

	if (flags.config) {
		config = await parseConfigFile(configPath);
	}

	// `meow` is set up to pass boolean flags as `undefined` if not passed.
	// copy the struct, and delete properties that are `undefined` so the merge
	// doesn't blast away config level settings.
	const strippedFlags = {...flags};
	for (const [key, value] of Object.entries(strippedFlags)) {
		if (value === undefined || (Array.isArray(value) && value.length === 0)) {
			// eslint-disable-next-line @typescript-eslint/no-dynamic-delete
			delete (strippedFlags as Record<string, Record<string, unknown>>)[key];
		}
	}

	// Combine the flags passed on the CLI with the flags in the config file,
	// with CLI flags getting precedence
	config = {...config, ...strippedFlags};
	return config;
}

const validConfigExtensions = ['.js', '.mjs', '.cjs', '.json'];
type ConfigExtensions = (typeof validConfigExtensions)[number];

async function parseConfigFile(configPath: string): Promise<Flags> {
	const typeOfConfig = getTypeOfConfig(configPath);

	switch (typeOfConfig) {
		case '.json': {
			return readJsonConfigFile(configPath);
		}

		case '.js':
		case '.mjs':
		case '.cjs': {
			return importConfigFile(configPath);
		}

		default: {
			throw new Error(`Config file ${configPath} is invalid`);
		}
	}
}

function getTypeOfConfig(configPath: string): ConfigExtensions {
	// Returning json in case file doesn't have an extension for backward compatibility
	const configExtension = path.extname(configPath) || '.json';

	if (validConfigExtensions.includes(configExtension)) {
		return configExtension;
	}

	throw new Error(
		`Config file should be either of extensions ${validConfigExtensions.join(
			',',
		)}`,
	);
}

async function importConfigFile(configPath: string): Promise<Flags> {
	// Use a filthy hack to prevent ncc / webpack from trying to process
	// the runtime dynamic import.  This hurt me more than it disgusts
	// whoever is reading the code.
	// eslint-disable-next-line no-new-func
	const _import = new Function('p', 'return import(p)');
	const config = (await _import(
		`file://${path.resolve(process.cwd(), configPath)}`,
	)) as {default: Flags};
	return config.default;
}

async function readJsonConfigFile(configPath: string): Promise<Flags> {
	const configFileContents = await fs.readFile(configPath, {
		encoding: 'utf8',
	});

	return JSON.parse(configFileContents) as Flags;
}
