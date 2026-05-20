/**
 * 排产结果验证 Action
 * 注册为 scheduling:validate
 * 校验排产结果的合理性，输出验证报告
 */
import type { Context } from '@nocobase/server';
export declare function validateSchedule(ctx: Context): Promise<void>;
