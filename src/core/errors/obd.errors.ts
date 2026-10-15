// Typed error classes for each architectural layer.
// Presentation catches these and maps them to user-facing messages.
// Never throw plain Error objects from domain or data layers.

// ─── Base ────────────────────────────────────────────────────────────────────

export abstract class OBDientError extends Error {
  abstract readonly code: string;

  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = this.constructor.name;
  }
}

// ─── Bluetooth / Adapter layer ────────────────────────────────────────────────

export class BluetoothNotAvailableError extends OBDientError {
  readonly code = 'BT_NOT_AVAILABLE';
}

export class BluetoothPermissionDeniedError extends OBDientError {
  readonly code = 'BT_PERMISSION_DENIED';
}

export class DeviceNotFoundError extends OBDientError {
  readonly code = 'BT_DEVICE_NOT_FOUND';
  constructor(readonly deviceName: string, cause?: unknown) {
    super(`Bluetooth device "${deviceName}" not found`, cause);
  }
}

export class ConnectionFailedError extends OBDientError {
  readonly code = 'BT_CONNECTION_FAILED';
  constructor(readonly deviceAddress: string, cause?: unknown) {
    super(`Failed to connect to device at ${deviceAddress}`, cause);
  }
}

export class ConnectionLostError extends OBDientError {
  readonly code = 'BT_CONNECTION_LOST';
}

export class MaxReconnectAttemptsError extends OBDientError {
  readonly code = 'BT_MAX_RECONNECT';
  constructor(readonly attempts: number) {
    super(`Bluetooth reconnection failed after ${attempts} attempts`);
  }
}

// ─── ELM327 protocol layer ────────────────────────────────────────────────────

export class AdapterInitError extends OBDientError {
  readonly code = 'ELM_INIT_FAILED';
}

export class ProtocolDetectionError extends OBDientError {
  readonly code = 'ELM_PROTOCOL_DETECT_FAILED';
}

export class CommandTimeoutError extends OBDientError {
  readonly code = 'ELM_COMMAND_TIMEOUT';
  constructor(readonly command: string, readonly timeoutMs: number) {
    super(`Command "${command}" timed out after ${timeoutMs}ms`);
  }
}

export class NoDataError extends OBDientError {
  readonly code = 'ELM_NO_DATA';
  constructor(readonly command: string) {
    super(`No data from adapter for command "${command}"`);
  }
}

export class ParseError extends OBDientError {
  readonly code = 'ELM_PARSE_ERROR';
  constructor(readonly rawResponse: string, cause?: unknown) {
    super(`Failed to parse adapter response: "${rawResponse}"`, cause);
  }
}

// ─── QVAC / LLM layer ────────────────────────────────────────────────────────

export class QvacUnavailableError extends OBDientError {
  readonly code = 'QVAC_UNAVAILABLE';
}

export class QvacRequestError extends OBDientError {
  readonly code = 'QVAC_REQUEST_FAILED';
  constructor(readonly statusCode: number, message: string) {
    super(`QVAC request failed with status ${statusCode}: ${message}`);
  }
}

export class QvacTimeoutError extends OBDientError {
  readonly code = 'QVAC_TIMEOUT';
}

// ─── Storage / Database layer ─────────────────────────────────────────────────

export class DatabaseError extends OBDientError {
  readonly code = 'DB_ERROR';
}

export class SessionNotFoundError extends OBDientError {
  readonly code = 'DB_SESSION_NOT_FOUND';
  constructor(readonly sessionId: string) {
    super(`Diagnostic session "${sessionId}" not found`);
  }
}

// ─── Type guard helpers ───────────────────────────────────────────────────────

export function isBluetoothError(
  error: unknown,
): error is BluetoothNotAvailableError | BluetoothPermissionDeniedError | DeviceNotFoundError | ConnectionFailedError | ConnectionLostError | MaxReconnectAttemptsError {
  return (
    error instanceof BluetoothNotAvailableError ||
    error instanceof BluetoothPermissionDeniedError ||
    error instanceof DeviceNotFoundError ||
    error instanceof ConnectionFailedError ||
    error instanceof ConnectionLostError ||
    error instanceof MaxReconnectAttemptsError
  );
}

export function isQvacError(
  error: unknown,
): error is QvacUnavailableError | QvacRequestError | QvacTimeoutError {
  return (
    error instanceof QvacUnavailableError ||
    error instanceof QvacRequestError ||
    error instanceof QvacTimeoutError
  );
}
