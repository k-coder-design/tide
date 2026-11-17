import type { AppError, ErrorCode } from '../../shared/types'

export class DomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'DomainError'
  }
}

/** Maps any error to the stable structure the interface shows. */
export function toAppError(error: unknown): AppError {
  if (error instanceof DomainError) return { code: error.code, message: error.message }
  console.error(error)
  return { code: 'INTERNAL', message: 'Something went wrong' }
}
