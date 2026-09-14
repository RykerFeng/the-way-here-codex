export class MemoryError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
    readonly next = "检查输入后重试。",
  ) {
    super(message);
    this.name = "MemoryError";
  }
}
