/**
 * Logger utility for consistent, timestamped logging across the application.
 *
 * Features:
 * - Multiple log levels (debug, info, warn, error)
 * - Timestamp prefixing for all logs
 * - Environment-aware logging (disabled in production for debug level)
 * - Optional namespace/category support for organized output
 *
 * @example
 * ```typescript
 * const logger = new Logger('AuthStore')
 * logger.info('User logged in', { userId: '123' })
 * logger.error('Login failed', error)
 * ```
 *
 * @example
 * ```typescript
 * // Global debug logging
 * Logger.setGlobalLevel('debug')
 * Logger.debug('App initialized', { version: '1.0.0' })
 * ```
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

const LOG_LEVEL_COLORS: Record<LogLevel, string> = {
  debug: '\x1b[36m', // Cyan
  info: '\x1b[34m',  // Blue
  warn: '\x1b[33m',  // Yellow
  error: '\x1b[31m', // Red
}

const RESET = '\x1b[0m'

/**
 * Formats a timestamp for log output.
 * @param date - The date to format (defaults to now)
 * @returns ISO-formatted timestamp string
 */
function formatTimestamp(date = new Date()): string {
  return date.toISOString().replace('T', ' ').slice(0, -1)
}

/**
 * Gets the appropriate console method for a log level.
 */
function getConsoleMethod(level: LogLevel): typeof console.log {
  switch (level) {
    case 'debug': return console.log
    case 'info': return console.info
    case 'warn': return console.warn
    case 'error': return console.error
    default: return console.log
  }
}

export class Logger {
  private namespace: string
  private level: LogLevel

  private static globalLevel: LogLevel = 'info'

  /**
   * Creates a new Logger instance.
   * @param namespace - Optional namespace/category for the logger (e.g., 'AuthStore', 'API')
   * @param level - Optional minimum log level (defaults to global level)
   */
  constructor(namespace?: string, level?: LogLevel) {
    this.namespace = namespace || 'App'
    this.level = level || Logger.globalLevel
  }

  /**
   * Sets the global minimum log level for all loggers.
   * @param level - The minimum log level to display
   */
  static setGlobalLevel(level: LogLevel): void {
    this.globalLevel = level
  }

  /**
   * Sets the minimum log level for this logger instance.
   * @param level - The minimum log level to display
   */
  setLevel(level: LogLevel): void {
    this.level = level
  }

  /**
   * Checks if a log level should be displayed based on current settings.
   */
  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.level] &&
           LOG_LEVELS[level] >= LOG_LEVELS[Logger.globalLevel]
  }

  /**
   * Formats and outputs a log message.
   */
  private output(level: LogLevel, message: string, ...args: unknown[]): void {
    if (!this.shouldLog(level)) return

    const timestamp = formatTimestamp()
    const prefix = `[${timestamp}] [${level.toUpperCase()}] [${this.namespace}]`

    // In browser, use styled console output
    if (typeof window !== 'undefined') {
      const browserPrefix = `%c${prefix}${RESET}`
      const colorStyle = `color: ${LOG_LEVEL_COLORS[level]}; font-weight: bold`
      getConsoleMethod(level)(browserPrefix, colorStyle, message, ...args)
    } else {
      // In Node.js, use plain text
      getConsoleMethod(level)(`${prefix} ${message}`, ...args)
    }
  }

  /**
   * Logs a debug message (lowest priority, typically disabled in production).
   * @param message - The message to log
   * @param args - Optional additional data to log
   *
   * @example
   * ```typescript
   * logger.debug('State updated', { previous, current })
   * ```
   */
  debug(message: string, ...args: unknown[]): void {
    this.output('debug', message, ...args)
  }

  /**
   * Logs an informational message (default level).
   * @param message - The message to log
   * @param args - Optional additional data to log
   *
   * @example
   * ```typescript
   * logger.info('User action completed', { action: 'save', duration: 150 })
   * ```
   */
  info(message: string, ...args: unknown[]): void {
    this.output('info', message, ...args)
  }

  /**
   * Logs a warning message for potentially harmful situations.
   * @param message - The message to log
   * @param args - Optional additional data to log
   *
   * @example
   * ```typescript
   * logger.warn('Deprecated API usage', { method: 'oldMethod', replacement: 'newMethod' })
   * ```
   */
  warn(message: string, ...args: unknown[]): void {
    this.output('warn', message, ...args)
  }

  /**
   * Logs an error message for error conditions.
   * @param message - The message to log
   * @param args - Optional error object or additional data
   *
   * @example
   * ```typescript
   * logger.error('Failed to fetch data', error)
   * logger.error('Network error', { url, status, response })
   * ```
   */
  error(message: string, ...args: unknown[]): void {
    this.output('error', message, ...args)
  }

  /**
   * Creates a child logger with a sub-namespace.
   * @param childNamespace - The child namespace to append
   * @returns A new Logger instance with the combined namespace
   *
   * @example
   * ```typescript
   * const apiLogger = new Logger('API')
   * const authLogger = apiLogger.child('Auth') // namespace: 'API:Auth'
   * ```
   */
  child(childNamespace: string): Logger {
    return new Logger(`${this.namespace}:${childNamespace}`, this.level)
  }
}

// Global logger instances for common use cases
export const appLogger = new Logger('App')
export const apiLogger = new Logger('API')
export const authLogger = new Logger('Auth')
export const uiLogger = new Logger('UI')

// Set debug level in development (Vite uses import.meta.env)
try {
  // @ts-ignore - Vite environment variable
  if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
    Logger.setGlobalLevel('debug')
  }
} catch {
  // Ignore if not in Vite environment
}
