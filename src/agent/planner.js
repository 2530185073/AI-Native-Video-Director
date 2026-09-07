import { validateEditingPlan } from '../schemas/editing-plan.js';

/**
 * 将 ASR、文案、素材分析结果转换为剪辑计划。
 *
 * 当前为 provider-agnostic 层，后续接入 GPT/Claude/Gemini/DeepSeek 等。
 */
export async function createEditingPlan({ llm, context }) {
  const prompt = `
你是一个短视频导演。
不要套模板，根据内容决定：
1. 是否保留人物
2. 是否需要图片解释
3. 哪些词需要强调
4. 哪些地方需要节奏变化

输出 JSON editing plan。

内容:
${JSON.stringify(context)}
`;

  const result = await llm.generate(prompt);
  const plan = typeof result === 'string' ? JSON.parse(result) : result;

  validateEditingPlan(plan);
  return plan;
}
