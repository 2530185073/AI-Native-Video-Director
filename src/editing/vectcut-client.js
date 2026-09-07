export class VectCutClient {
  constructor({ apiKey, baseUrl }) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  async createDraft(script) {
    // TODO: map EditingPlan JSON -> VectCut draft operations
    return {
      status: 'planned',
      script,
    };
  }

  async render(draftId) {
    throw new Error(`Render adapter pending for ${draftId}`);
  }
}
