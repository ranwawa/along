import { ChatOpenAI } from "@langchain/openai";
import { consola } from "consola";
import fs from "fs";
import os from "os";
import path from "path";

import { success, failure } from "./common";
import type { Result } from "./common";

const logger = consola.withTag("analyze-error");

function readClaudeSettings(): Record<string, string> {
  const settingsPath = path.join(os.homedir(), ".claude", "settings.json");
  try {
    const content = fs.readFileSync(settingsPath, "utf-8");
    const settings = JSON.parse(content);
    return settings.env || {};
  } catch {
    return {};
  }
}

const SYSTEM_PROMPT = `你是一个资深的研发工程师。你的任务是分析一条执行失败的任务日志，并给出故障根因和修复建议。
请尽量用中文简洁、准确地回答，格式如下：
**故障原因**: （精炼说明导致崩溃的原因）
**详细分析**: （结合日志解释为什么会报错）
**建议措施**: （给出可行的解决建议或命令）`;

export async function analyzeErrorLog(logContent: string): Promise<Result<string>> {
  const claudeEnv = readClaudeSettings();
  const apiKey = process.env.DEEPSEEK_API_KEY || claudeEnv.DEEPSEEK_API_KEY || "sk-099e5ef9e54d4a1f8760dd9e541cf5fd";

  if (!apiKey) {
    return failure("无法进行 AI 分析：未找到 DEEPSEEK_API_KEY。");
  }

  const modelName = process.env.ALONG_TRIAGE_MODEL || "deepseek-chat";
  
  // 取最后 8000 个字符以防止上下文过长
  const truncatedLog = logContent.slice(-8000);
  const userMessage = `这是一段截断的任务日志文件内容：\n\n\`\`\`log\n${truncatedLog}\n\`\`\`\n\n请分析日志并告诉我出错的原因以及应当如何修复。`;

  try {
    const llm = new ChatOpenAI({
      model: modelName,
      temperature: 0,
      maxTokens: 1024,
      configuration: {
        baseURL: "https://api.deepseek.com",
        apiKey,
      },
    });

    const result = await llm.invoke([
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ]);

    return success(result.content as string);
  } catch (error: any) {
    logger.error(`AI 分析失败: ${error.message}`);
    return failure(`AI 分析失败: ${error.message}`);
  }
}
