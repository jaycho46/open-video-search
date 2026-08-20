import { EXIT_CODES } from "./constants.js";

export type ErrorKind = keyof typeof EXIT_CODES;

export class OpenVideoError extends Error {
  readonly kind: ErrorKind;
  readonly exitCode: number;
  readonly details?: unknown;

  constructor(kind: ErrorKind, message: string, details?: unknown) {
    super(message);
    this.name = "OpenVideoError";
    this.kind = kind;
    this.exitCode = EXIT_CODES[kind];
    this.details = details;
  }
}

export function asOpenVideoError(error: unknown): OpenVideoError {
  if (error instanceof OpenVideoError) return error;
  if (error instanceof Error) return new OpenVideoError("processing", error.message);
  return new OpenVideoError("processing", String(error));
}

