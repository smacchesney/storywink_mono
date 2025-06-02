import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

// Read LOG_LEVEL from environment, default to 'warn' for less verbosity
const logLevel = process.env.LOG_LEVEL || 'warn';
// Basic validation (optional, pino defaults to 'info' on invalid input anyway)
const validLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'];
const finalLogLevel = validLevels.includes(logLevel) ? logLevel : 'warn';

// DEV: pretty print, synchronous, no extra worker thread
// Pass destination as second argument for pino v7+
const devLogger = pino({ level: finalLogLevel }, pino.destination({ sync: true }));

// PROD: JSON, suitable for log collectors
const prodLogger = pino({ level: finalLogLevel });

const logger = isDev ? devLogger : prodLogger;

// Log the level being used for confirmation (optional) - only in dev
if (process.env.NODE_ENV === 'development') {
  logger.warn(`Logger initialized with level: ${finalLogLevel}`);
}

export type Logger = typeof logger;
export default logger;