#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { arch, homedir, hostname, release, type } from 'node:os';
import path from 'node:path';

const VERSION = '2.0.2-kimi.1';
const API_URL = process.env.KIMI_DATASOURCE_API_URL ?? 'https://api.kimi.com/coding/v1/tools';
const REQUEST_TIMEOUT_MS = 30_000;
const VALID_STOCK_QUERY_TYPES = new Set([
  'realtime_price',
  'realtime_tech',
  'open_summary',
  'close_summary',
]);

const commands = {
  query_stock: {
    method: 'get_stock_realtime_price',
    buildParams(args) {
      const ticker = requiredString(args, 'ticker');
      const tickerList = ticker
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
      if (tickerList.length === 0) throw new Error('Missing required argument: ticker.');
      if (tickerList.length > 3) {
        throw new Error('ticker accepts at most 3 values separated by commas.');
      }

      const queryType = optionalString(args, 'type') ?? 'realtime_price';
      if (!VALID_STOCK_QUERY_TYPES.has(queryType)) {
        throw new Error(
          `type must be one of ${JSON.stringify([...VALID_STOCK_QUERY_TYPES])}; received: ${queryType}`,
        );
      }

      const params = {
        ticker,
        type: queryType,
        file_path: optionalString(args, 'file_path') ?? defaultStockFilePath(ticker, queryType),
      };
      const time = optionalString(args, 'time');
      if (time !== undefined) params.time = time;
      return params;
    },
    format(text, params) {
      return `${text}\n\nCSV data written to: ${params.file_path}`;
    },
  },
  get_data_source_desc: {
    method: 'get_data_source_desc',
    buildParams(args) {
      return { name: requiredString(args, 'name') };
    },
  },
  call_data_source_tool: {
    method: 'call_data_source_tool',
    buildParams(args) {
      return {
        data_source_name: requiredString(args, 'data_source_name'),
        api_name: requiredString(args, 'api_name'),
        params: requiredObject(args, 'params'),
      };
    },
  },
};

async function main() {
  const commandName = process.argv[2];
  if (commandName === undefined || commandName === 'help' || commandName === '--help') {
    printUsage();
    return;
  }

  const command = commands[commandName];
  if (command === undefined) {
    throw new Error(`Unknown command: ${commandName}`);
  }

  const args = await readArgs();
  const params = command.buildParams(args);
  const response = await callKimiTool(command.method, params);
  const text = extractText(response);
  process.stdout.write(`${(command.format?.(text, params) ?? text).trim()}\n`);
}

async function readArgs() {
  const inline = process.argv[3];
  const raw = inline !== undefined ? inline : await readStdin();
  if (raw.trim().length === 0) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed)) throw new Error('JSON arguments must be an object.');
    return parsed;
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new Error(`Failed to parse JSON arguments: ${err.message}`);
    }
    throw err;
  }
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let text = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      text += chunk;
    });
    process.stdin.on('error', reject);
    process.stdin.on('end', () => resolve(text));
  });
}

function resolveKimiHome() {
  const explicitHome = process.env.KIMI_CODE_HOME?.trim();
  return explicitHome && explicitHome.length > 0 ? explicitHome : path.join(homedir(), '.kimi-code');
}

async function loadAccessToken() {
  const kimiHome = resolveKimiHome();
  const credentialsFile = path.join(kimiHome, 'credentials', 'kimi-code.json');
  let parsed;
  try {
    parsed = JSON.parse(await readFile(credentialsFile, 'utf8'));
  } catch (err) {
    if (isNotFound(err)) {
      throw new Error(
        `Kimi Code credentials file not found: ${credentialsFile}\nRun /login in Kimi Code first.`,
      );
    }
    if (err instanceof SyntaxError) {
      throw new Error(`Failed to parse Kimi Code credentials file: ${err.message}`);
    }
    throw err;
  }

  if (!isRecord(parsed)) {
    throw new Error(`Invalid Kimi Code credentials file: ${credentialsFile}`);
  }
  const token = typeof parsed.access_token === 'string' ? parsed.access_token : '';
  if (token.length === 0) {
    throw new Error('Kimi Code credentials do not contain access_token. Run /login again.');
  }
  const expiresAt = typeof parsed.expires_at === 'number' ? parsed.expires_at : 0;
  if (expiresAt > 0 && expiresAt <= Math.floor(Date.now() / 1000)) {
    throw new Error('Kimi Code access_token has expired. Run /login again and retry.');
  }
  return { kimiHome, token };
}

async function callKimiTool(method, params) {
  const { kimiHome, token } = await loadAccessToken();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: await buildHeaders(kimiHome, token),
      body: JSON.stringify({ method, params }),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} error: ${text}`);
    }
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error(`Request timed out after ${REQUEST_TIMEOUT_MS / 1000} seconds.`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function buildHeaders(kimiHome, token) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Msh-Tool-Call-Id': randomUUID(),
    'X-Msh-Platform': asciiHeader(process.env.KIMI_MSH_PLATFORM ?? 'kimi-code-cli'),
    'X-Msh-Version': asciiHeader(process.env.KIMI_MSH_VERSION ?? VERSION),
    'X-Msh-Device-Name': asciiHeader(process.env.KIMI_MSH_DEVICE_NAME ?? hostname()),
    'X-Msh-Device-Model': asciiHeader(process.env.KIMI_MSH_DEVICE_MODEL ?? deviceModel()),
    'X-Msh-Os-Version': asciiHeader(process.env.KIMI_MSH_OS_VERSION ?? release()),
    'X-Msh-Device-Id': asciiHeader(process.env.KIMI_MSH_DEVICE_ID ?? (await createDeviceId(kimiHome))),
    'User-Agent': `kimi-datasource/${VERSION}`,
  };
}

async function createDeviceId(kimiHome) {
  const deviceIdPath = path.join(kimiHome, 'device_id');
  try {
    const existing = (await readFile(deviceIdPath, 'utf8')).trim();
    if (existing.length > 0) return existing;
  } catch {
    // Fall through and create a best-effort local device id.
  }

  const id = randomUUID();
  try {
    await mkdir(kimiHome, { recursive: true, mode: 0o700 });
    await writeFile(deviceIdPath, `${id}\n`, { encoding: 'utf8', mode: 0o600 });
  } catch {
    // Headers can still use the in-memory id if the file cannot be written.
  }
  return id;
}

function deviceModel() {
  const os = type();
  const osVersion = release();
  const osArch = arch();
  if (os === 'Darwin') return `macOS ${osVersion} ${osArch}`;
  if (os === 'Windows_NT') return `Windows ${osVersion} ${osArch}`;
  return `${os} ${osVersion} ${osArch}`.trim();
}

function extractText(response) {
  if (typeof response === 'string') return response;
  if (!isRecord(response)) return String(response);

  if (response.is_success === false) {
    const message = extractUserText(response.error) ?? JSON.stringify(response);
    throw new Error(`Tool API returned an error: ${message}`);
  }

  const text = extractUserText(response.result);
  if (text !== undefined) return text;
  return `Tool API succeeded but did not return user text. Raw response: ${JSON.stringify(response)}`;
}

function extractUserText(value) {
  if (!isRecord(value) || !Array.isArray(value.user)) return undefined;
  const text = value.user
    .filter((item) => isRecord(item) && item.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text)
    .filter(Boolean)
    .join('\n\n');
  return text.length > 0 ? text : undefined;
}

function defaultStockFilePath(ticker, queryType) {
  const safeTicker = ticker.replaceAll(',', '_').replaceAll('.', '_');
  return `/tmp/stock_${safeTicker}_${queryType}.csv`;
}

function requiredString(args, field) {
  const value = optionalString(args, field);
  if (value === undefined) throw new Error(`Missing required argument: ${field}.`);
  return value;
}

function optionalString(args, field) {
  if (!isRecord(args)) return undefined;
  const value = args[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new Error(`${field} must be a string.`);
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function requiredObject(args, field) {
  if (!isRecord(args)) throw new Error(`Missing required argument: ${field}.`);
  const value = args[field];
  if (!isRecord(value)) throw new Error(`${field} must be an object.`);
  return value;
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNotFound(err) {
  return isRecord(err) && err.code === 'ENOENT';
}

function asciiHeader(value, fallback = 'unknown') {
  const cleaned = String(value).replaceAll(/[^\u0020-\u007E]/g, '').trim();
  return cleaned.length > 0 ? cleaned : fallback;
}

function printUsage() {
  process.stdout.write(`Usage:
  node bin/kimi-datasource.mjs query_stock '{"ticker":"600519.SH"}'
  node bin/kimi-datasource.mjs get_data_source_desc '{"name":"stock_finance_data"}'
  node bin/kimi-datasource.mjs call_data_source_tool '{"data_source_name":"stock_finance_data","api_name":"...","params":{}}'

JSON arguments may also be passed on stdin.
`);
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
