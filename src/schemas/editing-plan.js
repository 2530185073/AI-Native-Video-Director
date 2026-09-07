/**
 * AI Native Video Director - Editing Plan Schema
 *
 * LLM 输出统一结构，后续由 VectCut Adapter 执行。
 */

export const EditingPlanSchema = {
  videoType: 'talking_head',
  goal: '',
  style: {
    energy: 'natural',
    subtitleStyle: 'dynamic',
  },
  scenes: [
    {
      start: 0,
      end: 0,
      purpose: '',
      keepPerson: true,
      visual: {
        type: 'original',
        assets: [],
      },
      subtitle: {
        text: '',
        highlights: [],
      },
      motion: {
        type: 'none',
      },
    },
  ],
};

export function validateEditingPlan(plan) {
  if (!plan || !Array.isArray(plan.scenes)) {
    throw new Error('Invalid editing plan');
  }
  return true;
}
