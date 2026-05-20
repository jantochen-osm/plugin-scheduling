const http = require('http');
const BASE = 'http://localhost:13000';

function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const url = new URL(path, BASE);
    const headers = { 'Content-Type': 'application/json', 'X-Role': 'admin' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const req = http.request(url, { method, headers }, (res) => {
      let chunks = '';
      res.on('data', c => chunks += c);
      res.on('end', () => resolve({ status: res.statusCode, body: chunks }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  // Login
  const loginRes = await request('POST', '/api/auth:signIn', { account: 'admin@nocobase.com', password: 'admin123' });
  const token = JSON.parse(loginRes.body).data?.token;
  if (!token) { console.log('Login failed'); return; }
  console.log('Logged in');

  // 1. Create schedule_runs collection
  console.log('\n=== Creating schedule_runs collection ===');
  const colRes = await request('POST', '/api/collections:create', {
    name: 'schedule_runs',
    title: '排产运行记录',
    fields: [
      { type: 'string', name: 'runId', title: '运行ID', interface: 'input', unique: true,
        uiSchema: { type: 'string', title: '运行ID', 'x-component': 'Input' } },
      { type: 'date', name: 'runTime', title: '运行时间', interface: 'datetime',
        uiSchema: { type: 'string', title: '运行时间', 'x-component': 'DatePicker', 'x-component-props': { showTime: true } } },
      { type: 'string', name: 'status', title: '状态', interface: 'input', defaultValue: 'COMPLETED',
        uiSchema: { type: 'string', title: '状态', 'x-component': 'Input' } },
      { type: 'integer', name: 'totalOrders', title: '总订单数', interface: 'integer',
        uiSchema: { type: 'number', title: '总订单数', 'x-component': 'InputNumber' } },
      { type: 'integer', name: 'validOrders', title: '有效订单数', interface: 'integer',
        uiSchema: { type: 'number', title: '有效订单数', 'x-component': 'InputNumber' } },
      { type: 'integer', name: 'scheduledCount', title: '排产成功数', interface: 'integer',
        uiSchema: { type: 'number', title: '排产成功数', 'x-component': 'InputNumber' } },
      { type: 'integer', name: 'exceptionCount', title: '异常数', interface: 'integer',
        uiSchema: { type: 'number', title: '异常数', 'x-component': 'InputNumber' } },
      { type: 'float', name: 'successRate', title: '成功率%', interface: 'percent',
        uiSchema: { type: 'number', title: '成功率%', 'x-component': 'InputNumber' } },
      { type: 'json', name: 'lineUtilization', title: '产线利用率', interface: 'json',
        uiSchema: { type: 'string', title: '产线利用率', 'x-component': 'Input.JSON' } },
      { type: 'json', name: 'exceptionBreakdown', title: '异常分布', interface: 'json',
        uiSchema: { type: 'string', title: '异常分布', 'x-component': 'Input.JSON' } },
    ],
  }, token);
  console.log('Collection:', colRes.status, colRes.status === 200 ? 'OK' : JSON.parse(colRes.body).errors?.[0]?.message);

  // 2. Add runId field to schedule_results_v2
  console.log('\n=== Adding runId to schedule_results_v2 ===');
  const r1 = await request('POST', '/api/fields:create', {
    type: 'string', name: 'runId', title: '排产批次',
    collectionName: 'schedule_results_v2',
    interface: 'input',
    uiSchema: { type: 'string', title: '排产批次', 'x-component': 'Input' },
  }, token);
  console.log('runId:', r1.status, r1.status === 200 ? 'OK' : JSON.parse(r1.body).errors?.[0]?.message);

  // 3. Add runId field to schedule_exceptions_v2
  console.log('\n=== Adding runId to schedule_exceptions_v2 ===');
  const r2 = await request('POST', '/api/fields:create', {
    type: 'string', name: 'runId', title: '排产批次',
    collectionName: 'schedule_exceptions_v2',
    interface: 'input',
    uiSchema: { type: 'string', title: '排产批次', 'x-component': 'Input' },
  }, token);
  console.log('runId:', r2.status, r2.status === 200 ? 'OK' : JSON.parse(r2.body).errors?.[0]?.message);

  console.log('\nDone!');
}

main().catch(e => console.error(e));
