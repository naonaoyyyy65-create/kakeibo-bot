/**
 * errors.js
 * カスタムエラークラス（GAS版 Error.gs の一部を移植・簡略化）
 */

class AppError extends Error {
  constructor(message, userMessage) {
    super(message);
    this.name = this.constructor.name;
    this.userMessage = userMessage || message;
  }
}

class ValidationError extends AppError {}
class NotFoundError extends AppError {}
class StateError extends AppError {}

class SheetError extends AppError {
  constructor(message, userMessage, operation) {
    super(message, userMessage);
    this.operation = operation;
  }
}

class LockedMonthError extends AppError {
  constructor(ym, status) {
    super(`Month ${ym} is locked (status: ${status})`, `${ym}は「${status}」のため編集できません`);
    this.ym = ym;
    this.status = status;
  }
}

class LineApiError extends AppError {
  constructor(message, statusCode, body) {
    super(message, 'LINEへの送信に失敗しました');
    this.statusCode = statusCode;
    this.body = body;
  }
}

module.exports = {
  AppError,
  ValidationError,
  NotFoundError,
  StateError,
  SheetError,
  LockedMonthError,
  LineApiError,
};
