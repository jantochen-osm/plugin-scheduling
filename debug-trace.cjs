const axios = require('axios');

const BASE = 'http://localhost:13000';
const TARGET_PROD_ID = 'ZMO00007234';

async function main() {
  // 登录
  const r = await axios.post(`${BASE}/api/auth:signIn`, {
    account: 'admin@nocobase.com', password: 'admin123'
  });
  const h = { Authorization: 'Bearer ' + r.data.data.token, 'X-Role': 'admin' };

  // 1. 查该订单
  console.log('=== 1. 订单数据 ===');
  const orders = await axios.get(`${BASE}/api/production_orders:list?filter={"ProdId":"${TARGET_PROD_ID}"}&pageSize=10`, { headers: h });
  const mo = orders.data.data?.[0];
  if (!mo) { console.log('未找到订单'); return; }
  console.log('ProdId:', mo.ProdId);
  console.log('ItemId:', mo.ItemId);
  console.log('QtySched:', mo.QtySched);
  console.log('DlvDate:', mo.DlvDate, '(raw type:', typeof mo.DlvDate, ')');
  console.log('ProdPoolId:', mo.ProdPoolId);
  console.log('OSM_Category:', mo.OSM_Category);
  console.log('ProdStatus:', mo.ProdStatus);

  // 2. 查该 ItemId 的所有工艺路线（不只 Assembly）
  console.log('\n=== 2. 工艺路线 (ItemId=' + mo.ItemId + ') ===');
  const routes = await axios.get(`${BASE}/api/route_operation:list?filter={"fg_item_code":"${mo.ItemId}"}&pageSize=100`, { headers: h });
  (routes.data.data || []).forEach((rt, i) => {
    console.log(`  [${i}] operation_name="${rt.operation_name}" erp_uph=${rt.erp_uph} erp_plan_labor=${rt.erp_plan_labor}`);
  });
  // 看引擎会选哪个
  const assemblyOps = (routes.data.data || []).filter(rt => (rt.operation_name || '').toLowerCase().includes('assembly') && Number(rt.erp_uph) > 0);
  console.log(`  Assembly 匹配数: ${assemblyOps.length}`);
  if (assemblyOps.length > 0) {
    const last = assemblyOps[assemblyOps.length - 1];
    console.log(`  ** 引擎实际使用(最后一条): uph=${last.erp_uph}, headcount=${last.erp_plan_labor}`);
  }

  // 3. 查日历 05-18 ~ 05-21 范围
  console.log('\n=== 3. 日历数据 (05-18 ~ 05-21) ===');
  const cals = await axios.get(`${BASE}/api/md_work_calendars:list?pageSize=500`, { headers: h });
  const calData = (cals.data.data || []).filter(c => {
    const d = c.calendarDate ? c.calendarDate.toString().slice(0, 10) : '';
    return d >= '2026-05-18' && d <= '2026-05-21';
  });
  calData.forEach(c => {
    console.log(`  date=${c.calendarDate} workHours=${c.workHours} isSchedulable=${c.isSchedulable}`);
  });

  // 4. 查排产结果
  console.log('\n=== 4. 排产结果 ===');
  const res = await axios.get(`${BASE}/api/schedule_results_v2:list?filter={"prodId":"${TARGET_PROD_ID}"}&pageSize=10`, { headers: h });
  (res.data.data || []).forEach(sr => {
    console.log('  prodId:', sr.prodId, 'itemId:', sr.itemId);
    console.log('  uph:', sr.uph, 'headcount:', sr.headcount);
    console.log('  totalQty:', sr.totalQty);
    console.log('  chosenLine:', sr.chosenLine);
    console.log('  startDate:', sr.startDate, 'finishDate:', sr.finishDate);
    console.log('  isOverdue:', sr.isOverdue, 'overdueDays:', sr.overdueDays);
    console.log('  dailyPlan:', JSON.stringify(sr.dailyPlan));
  });

  // 5. 计算验证
  if (assemblyOps.length > 0 && calData.length > 0) {
    const uph = Number(assemblyOps[assemblyOps.length - 1].erp_uph);
    const wh = Number(calData[0]?.workHours) || 10;
    console.log(`\n=== 5. 计算验证 ===`);
    console.log(`  UPH=${uph}, workHours=${wh}`);
    console.log(`  理论单日最大产量 = ${uph} × ${wh} = ${uph * wh}`);
    console.log(`  订单数量 = ${mo.QtySched}`);
    console.log(`  需要天数 = ${(Number(mo.QtySched) / (uph * wh)).toFixed(2)}`);
  }
}

main().catch(e => console.error('Error:', e.response?.data || e.message));
