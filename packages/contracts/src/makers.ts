const MAKERS: [RegExp, string][] = [[/^claude/, 'Anthropic'], [/^(gpt|o\d|codex|chatgpt)/, 'OpenAI'], [/^gemini/, 'Google']];
export const modelFamily = (model: string): string => MAKERS.find(([re]) => re.test(model.toLowerCase()))?.[1] ?? model.toLowerCase().split(/[-_.\s]/)[0]!;
