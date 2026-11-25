class AutomationError extends Error {
  constructor(message, code = 'AUTOMATION_ERROR', details = null) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.details = details;
    this.timestamp = new Date().toISOString();
  }
}

class AuthError extends AutomationError {
  constructor(message, details = null) {
    super(message, 'AUTH_ERROR', details);
  }
}

class NavigationError extends AutomationError {
  constructor(message, details = null) {
    super(message, 'NAVIGATION_ERROR', details);
  }
}

class EditorError extends AutomationError {
  constructor(message, details = null) {
    super(message, 'EDITOR_ERROR', details);
  }
}

class VerificationError extends AutomationError {
  constructor(message, details = null) {
    super(message, 'VERIFICATION_ERROR', details);
  }
}

module.exports = {
  AutomationError,
  AuthError,
  NavigationError,
  EditorError,
  VerificationError
};
