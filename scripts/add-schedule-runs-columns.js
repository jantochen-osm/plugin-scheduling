const { execSync } = require('child_process');
const path = require('path');

// 直接用 sequelize 连接执行 SQL
const root = path.resolve(__dirname, '../../..');
process.chdir(root);

async function run() {
  const { createStoragePluginsSymlink } = require('./packages/core/server/dist/server.js').default || {};
  
  // 加载 nocobase 应用获取 DB 连接
  const Application = require('./packages/core/server').Application || 
                      require('./packages/core/server').default;

  console.log('Connecting to database...');
  
  // 直接读取 .env 获取数据库配置
  require('dotenv').config({ path: './.env' });
  
  const { Sequelize } = require('sequelize');
  
  const dbUrl = process.env.DB_URL || 
    `postgres://${process.env.DB_USER || 'postgres'}:${process.env.DB_PASSWORD || ''}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 5432}/${process.env.DB_DATABASE || 'nocobase'}`;
  
  console.log('DB_URL:', dbUrl.replace(/:[^:@]*@/, ':***@'));
  
  const seq = new Sequelize(dbUrl, { logging: false });
  
  try {
    await seq.authenticate();
    console.log('Connected!');
    
    await seq.query(`ALTER TABLE schedule_runs ADD COLUMN IF NOT EXISTS "selectedProdIds" jsonb`);
    console.log('Added: selectedProdIds');
    
    await seq.query(`ALTER TABLE schedule_runs ADD COLUMN IF NOT EXISTS "runMode" varchar(50) DEFAULT 'FULL'`);
    console.log('Added: runMode');
    
    // 验证
    const [cols] = await seq.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'schedule_runs' 
      ORDER BY ordinal_position
    `);
    console.log('\nCurrent schedule_runs columns:');
    cols.forEach(c => console.log(' -', c.column_name, ':', c.data_type));
    
  } finally {
    await seq.close();
  }
}

run().catch(e => { console.error('Error:', e.message); process.exit(1); });
