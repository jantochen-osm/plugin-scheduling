const axios = require('axios');

async function main() {
  const r = await axios.post('http://localhost:13000/api/auth:signIn', {
    account: 'admin@nocobase.com', password: 'admin123'
  });
  const t = r.data.data.token;
  const h = { Authorization: 'Bearer ' + t, 'X-Role': 'admin' };

  // 清旧数据
  const oldE = await axios.get('http://localhost:13000/api/schedule_exceptions:list?pageSize=1', { headers: h });
  console.log('旧异常数:', oldE.data.meta?.count || 0);

  // 重跑排产
  const sched = await axios.post('http://localhost:13000/api/scheduling:run', {}, { headers: h });
  console.log('排产响应:', JSON.stringify(sched.data.data));

  // 查异常分布
  const exc = await axios.get('http://localhost:13000/api/schedule_exceptions:list?pageSize=500', { headers: h });
  const byType = {};
  (exc.data.data || []).forEach(e => {
    byType[e.exceptionType] = (byType[e.exceptionType] || 0) + 1;
  });
  console.log('\n异常分布:');
  Object.entries(byType).sort((a,b) => b[1] - a[1]).forEach(function(e) { console.log('  ' + e[0] + ': ' + e[1]); });

  // 每种异常抽1条样本
  const seen = new Set();
  console.log('\n异常样本:');
  (exc.data.data || []).forEach(e => {
    if (!seen.has(e.exceptionType)) {
      seen.add(e.exceptionType);
      console.log(`  [${e.exceptionType}] prodId=${e.prodId} item=${e.itemId} msg=${e.message}`);
    }
  });

  // 结果
  const res = await axios.get('http://localhost:13000/api/schedule_results:list?pageSize=3', { headers: h });
  console.log('\n结果数:', res.data.meta?.count || res.data.data.length);
  if (res.data.data?.[0]) console.log('样本:', JSON.stringify(res.data.data[0], null, 2));
}
main().catch(e => console.error(e.message));
