/**
 * runScheduling.ts
 *
 * 排产引擎 HTTP 入口。
 *
 * 路由：
 *   POST /api/scheduling:run            ← 运行 EE + ESG 全量排产
 *   POST /api/scheduling:run?strategy=EE   ← 仅 EE
 *   POST /api/scheduling:run?strategy=ESG  ← 仅 ESG
 *
 * 本文件只负责：
 *   1. 解析策略参数，构建 strategy 列表
 *   2. 调用 pipeline（step1~step5 + scheduleAll）
 *   3. 将结果写入数据库（schedule_results_v2 / schedule_exceptions_v2 / schedule_runs）
 *   4. 返回 HTTP 响应
 *
 * 核心排产逻辑见 ./scheduling/ 子模块。
 */
import type { Context } from '@nocobase/actions';
export declare function runScheduling(ctx: Context): Promise<void>;
