export interface ToolError {
  code: string;
  message: string;
}

export type ToolResult<T> = { ok: true; data: T } | { ok: false; error: ToolError };
