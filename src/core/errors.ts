export class LabError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LabError'
  }
}
