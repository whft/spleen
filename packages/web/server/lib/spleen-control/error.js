export class SpleenControlError extends Error {
  constructor(message, statusCode = 500, details = {}) {
    super(message);
    this.name = 'SpleenControlError';
    this.statusCode = statusCode;
    Object.assign(this, details);
  }
}

export const asControlError = (error, fallbackMessage, fallbackStatus = 500) => {
  if (error instanceof SpleenControlError) return error;
  const message = error instanceof Error ? error.message : fallbackMessage;
  return new SpleenControlError(message || fallbackMessage, Number(error?.statusCode) || Number(error?.status) || fallbackStatus, {
    ...(error?.goalConfigured === true ? { goalConfigured: true } : {}),
  });
};
