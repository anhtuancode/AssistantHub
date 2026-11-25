const logger = require('./logger');

/**
 * Safe retry mechanism for idempotent read operations.
 * NOTE: For write/mutation operations, do NOT blind retry without prior verification!
 */
async function retryOperation(fn, options = {}) {
  const {
    maxRetries = 3,
    delayMs = 1500,
    backoffFactor = 1.5,
    description = 'Operation'
  } = options;

  let lastError = null;
  let currentDelay = delayMs;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      logger.warn(`[Retry] ${description} thất bại (Lần ${attempt}/${maxRetries}): ${err.message}`);
      if (attempt < maxRetries) {
        await new Promise(res => setTimeout(res, currentDelay));
        currentDelay = Math.round(currentDelay * backoffFactor);
      }
    }
  }

  throw lastError;
}

module.exports = {
  retryOperation
};
