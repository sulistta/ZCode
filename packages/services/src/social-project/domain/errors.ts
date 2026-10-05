export class SocialProjectInvalidOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SocialProjectInvalidOperationError";
  }
}
