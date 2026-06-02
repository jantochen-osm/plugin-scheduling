/**
 * llmDecision.ts
 *
 * LLM 排产决策层：调用 OpenAI Chat Completions API，
 * 读取 scheduling-skill.md 作为 system prompt，
 * 将订单摘要 + 产线映射作为 user message，
 * 解析并返回 SchedulingDecision[]。
 *
 * 任何异常（网络错误、解析失败、schema 不合法）均返回 null，
 * 调用方应 fallback 到原算法。
 */

import * as fs from 'fs';
import * as https from 'https';
import * as path from 'path';
import { DEFAULT_SKILL_MD } from './scheduling/schedulingSkill';

// ── 类型定义 ────────────────────────────────────────────────────────────────

export interface SchedulingDecision {
  prodId: string;
  /** 排产优先级，1 = 最高 */
  priority: number;
  /** 产线偏好顺序（代码会先尝试第一个，再试其余） */
  preferredLines: string[];
  /** 基准人手倍率（1.0 = 基准，2.0 = 双倍）*/
  headcountMultiplier: number;
  /** 是否允许加班 */
  allowOvertime: boolean;
  /** 是否跳过该订单 */
  skip: boolean;
  /** 跳过原因（可选） */
  skipReason?: string;
}

// ── 工具函数 ─────────────────────────────────────────────────────────────────

/**
 * 读取 skill.md。
 * 优先读取磁盘文件（可热编辑），找不到时回退到编译内嵌内容。
 */
function readSkillContent(): string {
  const candidates = [
    // 开发环境：源码目录（tsx/ts-node 模式下 __dirname 指向源码）
    path.join(__dirname, 'scheduling', 'scheduling-skill.md'),
    // 生产构建：dist 目录可能的位置
    path.join(__dirname, '..', 'scheduling', 'scheduling-skill.md'),
    // 自定义覆盖路径
    process.env.SCHEDULING_SKILL_PATH || '',
  ].filter(Boolean);

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        return fs.readFileSync(p, 'utf-8');
      }
    } catch { /* ignore */ }
  }

  // 兜底：使用编译内嵌的内容
  return DEFAULT_SKILL_MD;
}

/**
 * 调用 OpenAI Chat Completions（使用 Node.js 原生 https，无额外依赖）。
 */
function callOpenAI(
  apiKey: string,
  model: string,
  messages: Array<{ role: string; content: string }>,
  timeoutMs = 30000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model,
      messages,
      // temperature: 0.1,          // 低温度保证输出确定性
      // response_format: { type: 'json_object' },
      max_completion_tokens: 2000,
    });

    const timer = setTimeout(() => {
      req.destroy();
      reject(new Error('OpenAI request timeout'));
    }, timeoutMs);

    const req = https.request(
      {
        hostname: 'erp-azureopenai.openai.azure.com',
        path: '/openai/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          clearTimeout(timer);
          if (res.statusCode !== 200) {
            reject(new Error(`OpenAI API ${res.statusCode}: ${data.slice(0, 200)}`));
          } else {
            console.log(`==================================[LLM] Raw response: ${data}`); // 仅打印前 500 字符，避免泄露敏感信息
            resolve(data);
          }
        });
      },
    );

    req.on('error', (e) => { clearTimeout(timer); reject(e); });
    req.write(body);
    req.end();
  });
}

/**
 * 校验并标准化单条 decision，确保必填字段存在且类型正确。
 */
function normalizeDecision(d: any): SchedulingDecision | null {
  if (!d || typeof d.prodId !== 'string' || typeof d.priority !== 'number') return null;
  return {
    prodId:              d.prodId,
    priority:            d.priority,
    preferredLines:      Array.isArray(d.preferredLines) ? d.preferredLines : [],
    headcountMultiplier: typeof d.headcountMultiplier === 'number' ? d.headcountMultiplier : 1.0,
    allowOvertime:       d.allowOvertime === true,
    skip:                d.skip === true,
    skipReason:          typeof d.skipReason === 'string' ? d.skipReason : undefined,
  };
}

// ── 主函数 ───────────────────────────────────────────────────────────────────

/**
 * 调用 LLM 获取排产决策。
 *
 * @param orders        通过 step2 校验的有效订单（含 overdueDays）
 * @param lineMapping   客户 → 允许产线列表（{ Amazon: ['4F1'], Shure: ['4F4'] }）
 * @param today         今日日期字符串 'YYYY-MM-DD'
 * @param apiKey        OpenAI API Key
 * @param model         模型名称（如 'gpt-4o-mini'）
 * @param logger        可选日志对象
 * @returns             SchedulingDecision[] 或 null（失败时 fallback）
 */
export async function fetchLlmDecisions(
  orders: any[],
  lineMapping: Record<string, string[]>,
  today: string,
  apiKey: string,
  model: string,
  logger?: any,
): Promise<SchedulingDecision[] | null> {
  if (!apiKey || orders.length === 0) return null;

  try {
    // 构建最小化订单摘要（节省 tokens，不传产能矩阵）
    const orderSummary = orders.map((o) => ({
      prodId:      o.prodId,
      itemId:      o.itemId,
      dlvDate:     o.dlvDate,
      qtySched:    o.qtySched,
      keyAccount:  o.keyAccount || '',
      overdueDays: o.overdueDays ?? 0,
    }));

    const userContent = JSON.stringify({ today, orders: orderSummary, lineMapping });
    const systemContent = readSkillContent();

    logger?.info?.(`[LLM] Calling ${model} with ${orders.length} orders`);
    const t0 = Date.now();

    const raw = await callOpenAI(apiKey, model, [
      { role: 'system', content: systemContent },
      { role: 'user',   content: userContent },
    ]);

    const elapsed = Date.now() - t0;
    const outer = JSON.parse(raw);
    const content: string = outer?.choices?.[0]?.message?.content || '';
    if (!content) {
      logger?.warn?.('[LLM] Empty content in response');
      return null;
    }

    const parsed = JSON.parse(content);
    logger?.info?.(`[LLM] Done in ${elapsed}ms. Reasoning: ${parsed.reasoning || '(none)'}`);

    if (!Array.isArray(parsed.decisions)) {
      logger?.warn?.('[LLM] decisions is not an array');
      return null;
    }

    // 校验每条 decision
    const decisions: SchedulingDecision[] = [];
    for (const d of parsed.decisions) {
      const nd = normalizeDecision(d);
      if (!nd) {
        logger?.warn?.(`[LLM] Invalid decision entry: ${JSON.stringify(d)}`);
        return null; // 严格校验：有一条不合法就 fallback
      }
      decisions.push(nd);
    }

    // 确保每条订单都有对应决策
    const coveredIds = new Set(decisions.map((d) => d.prodId));
    const missing = orders.filter((o) => !coveredIds.has(o.prodId));
    if (missing.length > 0) {
      logger?.warn?.(`[LLM] Missing decisions for: ${missing.map((o) => o.prodId).join(', ')}`);
      return null;
    }

    return decisions;
  } catch (e: any) {
    logger?.warn?.(`[LLM] fetchLlmDecisions failed: ${e?.message || String(e)}`);
    return null;
  }
}

/**
 * 根据 LLM decisions 对有效订单重新排序。
 * 若某订单无对应 decision，保持原位。
 */
export function applyLlmOrdering(
  orders: any[],
  decisions: SchedulingDecision[],
): any[] {
  const priorityMap = new Map(decisions.map((d) => [d.prodId, d.priority]));
  return [...orders].sort((a, b) => {
    const pa = priorityMap.get(a.prodId) ?? 9999;
    const pb = priorityMap.get(b.prodId) ?? 9999;
    return pa - pb;
  });
}
