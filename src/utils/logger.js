const fs = require('fs');
const path = require('path');

class Logger {
  constructor() {
    this.logs = [];
    this.maxLogs = 500;
    this.logFile = path.join(__dirname, '../../automation.log');
  }

  formatTime() {
    const d = new Date();
    return d.toTimeString().split(' ')[0] + '.' + String(d.getMilliseconds()).padStart(3, '0');
  }

  sanitize(msg) {
    if (typeof msg !== 'string') {
      try {
        msg = JSON.stringify(msg);
      } catch {
        msg = String(msg);
      }
    }
    // Mask password or tokens
    return msg
      .replace(/(password["']?\s*[:=]\s*["']?)([^"'\s,]+)(["']?)/gi, '$1***PROTECTED***$3')
      .replace(/(secret["']?\s*[:=]\s*["']?)([^"'\s,]+)(["']?)/gi, '$1***PROTECTED***$3')
      .replace(/(token["']?\s*[:=]\s*["']?)([^"'\s,]+)(["']?)/gi, '$1***PROTECTED***$3');
  }

  log(level, message, data = null) {
    const time = this.formatTime();
    const cleanMsg = this.sanitize(message);
    const entry = {
      id: Date.now() + '-' + Math.random().toString(36).substring(2, 7),
      time,
      level,
      message: cleanMsg,
      data: data ? this.sanitize(JSON.stringify(data)) : null
    };

    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    const consolePrefix = `[${time}] [${level}]`;
    if (level === 'ERROR') {
      console.error(consolePrefix, cleanMsg, data || '');
    } else if (level === 'WARN') {
      console.warn(consolePrefix, cleanMsg, data || '');
    } else {
      console.log(consolePrefix, cleanMsg, data || '');
    }

    try {
      fs.appendFileSync(this.logFile, `${consolePrefix} ${cleanMsg}\n`, 'utf8');
    } catch (_) {}
  }

  info(msg, data) { this.log('INFO', msg, data); }
  warn(msg, data) { this.log('WARN', msg, data); }
  error(msg, data) { this.log('ERROR', msg, data); }
  debug(msg, data) { this.log('DEBUG', msg, data); }

  getRecentLogs(limit = 100) {
    return this.logs.slice(-limit);
  }

  clear() {
    this.logs = [];
  }
}

module.exports = new Logger();
