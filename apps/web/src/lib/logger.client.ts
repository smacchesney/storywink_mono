// Minimal shim so client code can call logger.info() without failing
const logger = {
    debug: (...args: unknown[]) => console.debug(...args),
    info:  (...args: unknown[]) => console.info (...args),
    warn:  (...args: unknown[]) => console.warn (...args),
    error: (...args: unknown[]) => console.error(...args),
  };
  
  export default logger;
  export type Logger = typeof logger;
  