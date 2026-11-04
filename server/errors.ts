export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "REQUEST_FAILED",
  ) {
    super(message);
  }
}
export const conflict = (
  message = "The unit changed or is no longer available. Refresh and try again.",
) => new ApiError(409, message, "STATE_CONFLICT");
