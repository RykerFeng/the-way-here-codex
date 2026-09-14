import { MemoryError } from "./errors.js";

export function success(command: string, value: Record<string, unknown> = {}): void {
  process.stdout.write(`${JSON.stringify({ ok: true, command, ...value })}\n`);
}

export function failure(error: unknown): void {
  const normalized = error instanceof MemoryError
    ? error
    : new MemoryError("INTERNAL_ERROR", error instanceof Error ? error.message : String(error), false, "检查命令参数，仍失败时查看 README。 ");
  process.stderr.write(`${JSON.stringify({
    ok: false,
    error: { code: normalized.code, retryable: normalized.retryable, message: normalized.message, next: normalized.next },
  })}\n`);
}
