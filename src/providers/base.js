export class BaseLLMProvider {
  constructor(config = {}) {
    this.config = config;
  }

  async generate() {
    throw new Error('Provider must implement generate()');
  }
}
