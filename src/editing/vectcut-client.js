// VectCut execution adapter
// EditingPlan JSON -> VectCut draft operations

export class VectCutClient {
  constructor({ apiKey, baseUrl }) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl || 'https://api.vectcut.com';
  }

  async createDraft(editingPlan) {
    // Next step: call VectCut API create draft endpoint.
    // Keep plan untouched so every operation remains editable.
    return {
      status: 'prepared',
      provider: 'vectcut',
      editingPlan
    };
  }

  async render(draftId, options = {}) {
    // Next step: cloud render endpoint integration.
    return {
      draftId,
      status: 'queued',
      options
    };
  }
}

export async function createVectCutDraft(plan, config) {
  const client = new VectCutClient(config || {});
  return client.createDraft(plan);
}
