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
 * 模式：全量覆盖——每次执行删除全部旧结果，写入完整新快照。
 * 每次运行都与一个唯一 runId 绑定，为将来版本历史功能预留扩展点。
 *
 * 核心排产逻辑见 ./scheduling/ 子模块。
 */
import type { Context } from '@nocobase/actions';
export declare function runScheduling(ctx: Context): Promise<void>;
