import { validateEditingPlan } from '../schemas/editing-plan.js';

/**
 * AI Director planning layer.
 * Receives ASR + script + assets and returns an editable plan.
 */
export async function createEditingPlan({ llm, context }) {
  const prompt = `
你是一个短视频导演。
不要套模板，根据内容决定：
1. 是否保留人物
2. 是否需要商品/案例/解释素材
3. 哪些词需要强调
4. 哪些地方需要节奏变化
5. 是否需要局部放大、对比、信息卡片

目标：生成可执行的 editing plan JSON。

输入:
${JSON.stringify(context)}
`;

  const result = await llm.generate(prompt);
  const plan = typeof result === 'string' ? JSON.parse(result) : result;

  validateEditingPlan(plan);
  return plan;
}
