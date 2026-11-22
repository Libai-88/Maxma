/** Cowork 任务域的领域错误；路由层按 `code` 映射 400/404/409。 */
export class CoworkConflictError extends Error {
  readonly code = "COWORK_CONFLICT";
  constructor(message: string) {
    super(message);
    this.name = "CoworkConflictError";
  }
}

export class CoworkNotFoundError extends Error {
  readonly code = "COWORK_NOT_FOUND";
  constructor(message: string) {
    super(message);
    this.name = "CoworkNotFoundError";
  }
}

export class CoworkValidationError extends Error {
  readonly code = "COWORK_VALIDATION";
  constructor(message: string) {
    super(message);
    this.name = "CoworkValidationError";
  }
}
