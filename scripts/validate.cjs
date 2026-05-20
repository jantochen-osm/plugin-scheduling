/**
 * 排产结果验证脚本
 * 
 * 用途：验证排产引擎输出的合理性，检查 6 条规则
 * 
 * 使用方式：
 *   node packages/plugins/@osm/plugin-scheduling/scripts/validate.cjs
 * 
 * 前提条件：
 *   1. NocoBase 服务已启动 (默认 http://localhost:13000)
 *   2. 已执行过至少一次排产 (scheduling:run)
 * 
 * ═══════════════════════════════════════════════
 *  验证规则说明
 * ═══════════════════════════════════════════════
 * 
 *  V1 不超产    每日产量 ≤ UPH × 当日工时
 *               确保不会超出产线物理产能
 * 
 *  V2 不漏排    ∑dailyPlan = totalQty
 *               排产计划的总数必须等于订单数量
 * 
 *  V3 不跨线    每个 MO 只使用一条产线
 *               同一生产单号不能分散在多条线上
 * 
 *  V4 不超时    同一线同一天的总工时 ≤ 日历工时
 *               多个订单共用一条线时不能超出当天产能
 * 
 *  V5 不排休息日 排产日期必须在日历可排天内
 *               不能把产量排在休息日/假日上
 * 
 *  V6 无碎片    日产量不能 < 10（小单除外）
 *               避免出现零星 1~2 个的分散排产
 * 
 * ═══════════════════════════════════════════════
 */

const http = require('http');
const BASE = process.env.NOCOBASE_URL || 'http://localhost:13000';

// ─── HTTP helpers ───
function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const url = new URL(path, BASE);
    const headers = { 'Content-Type': 'application/json', 'X-Role': 'admin' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const req = http.request(url, { method, headers }, (res) => {
      let chunks = '';
      res.on('data', c => chunks += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(chunks) }); }
        catch { resolve({ status: res.statusCode, body: chunks }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// ─── Formatting ───
const PASS = '\x1b[32m✔ PASS\x1b[0m';
const FAIL = '\x1b[31m✘ FAIL\x1b[0m';
const WARN = '\x1b[33m⚠\x1b[0m';
const BOLD = (s) => `\x1b[1m${s}\x1b[0m`;
const DIM  = (s) => `\x1b[2m${s}\x1b[0m`;

function printRule(check) {
  const status = check.pass ? PASS : FAIL;
  const count = check.violations?.length || 0;
  console.log(`  ${status}  ${BOLD(check.rule)} ${check.name}${count > 0 ? `  (${count} 违规)` : ''}`);
  if (count > 0) {
    const show = check.violations.slice(0, 5);
    for (const v of show) {
      const parts = [v.prodId, v.line, v.date].filter(Boolean).join(' | ');
      console.log(`         ${WARN} ${DIM(parts)}  ${v.detail}`);
    }
    if (count > 5) console.log(`         ${DIM(`... 还有 ${count - 5} 条`)}`);
  }
}

// ─── Main ───
async function main() {
  console.log('\n' + BOLD('═══ 排产结果验证 ═══') + '\n');

  // 1. Login
  process.stdout.write('  登录中...');
  const loginRes = await request('POST', '/api/auth:signIn', {
    account: 'admin@nocobase.com',
    password: 'admin123',
  });
  const token = loginRes.body?.data?.token;
  if (!token) {
    console.log(' 失败');
    console.error('  登录失败:', JSON.stringify(loginRes.body));
    process.exit(1);
  }
  console.log(' OK\n');

  // 2. Call validate API
  process.stdout.write('  执行验证...');
  const valRes = await request('POST', '/api/scheduling:validate', null, token);
  if (valRes.status !== 200 || !valRes.body?.data) {
    console.log(' 失败');
    console.error('  验证 API 返回:', valRes.status, JSON.stringify(valRes.body));
    process.exit(1);
  }
  console.log(' OK\n');

  const data = valRes.body.data;

  // 3. Summary
  console.log(BOLD('  ── 数据概况 ──'));
  console.log(`  排产结果: ${data.summary.totalResults} 条`);
  console.log(`  异常记录: ${data.summary.totalExceptions} 条`);
  if (data.summary.exceptionBreakdown && Object.keys(data.summary.exceptionBreakdown).length > 0) {
    console.log(`  异常分布:`);
    for (const [type, count] of Object.entries(data.summary.exceptionBreakdown)) {
      console.log(`    ${type}: ${count}`);
    }
  }

  // 4. Rules
  console.log('\n' + BOLD('  ── 规则验证 ──'));
  for (const check of data.checks) {
    printRule(check);
  }

  // 5. Overall
  const allPass = data.checks.every(c => c.pass);
  console.log('\n' + '─'.repeat(45));
  if (allPass) {
    console.log(`  ${PASS}  ${BOLD('所有规则通过')} — 排产结果合理`);
  } else {
    const failCount = data.checks.filter(c => !c.pass).length;
    console.log(`  ${FAIL}  ${BOLD(`${failCount} 条规则未通过`)} — 请检查违规项`);
  }
  console.log('');
}

main().catch(e => {
  console.error('\n  脚本执行出错:', e.message);
  process.exit(1);
});
