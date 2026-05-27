import { Application } from '@nocobase/server';
import { resolve } from 'path';

export default async function run(app: Application) {
  const db = app.db;
  console.log('Seeding initial data for Task 1.1...');

  // 1. production_stages
  const ProductionStages = db.getRepository('production_stages');
  if (ProductionStages) {
    const stageCount = await ProductionStages.count();
    if (stageCount === 0) {
      await ProductionStages.create({
        values: [
          { stageId: 'STAGE_001', stageName: 'Assembly', stageSequence: 1, remarks: 'SMT & Assembly' },
          { stageId: 'STAGE_002', stageName: 'Package', stageSequence: 2, remarks: 'Packaging' },
        ],
      });
      console.log('✅ Created production_stages data.');
    } else {
      console.log('ℹ️ production_stages already has data.');
    }
  }

  // 2. product_stage_mapping
  const ProductStageMapping = db.getRepository('product_stage_mapping');
  if (ProductStageMapping) {
    const psmCount = await ProductStageMapping.count();
    if (psmCount === 0) {
      await ProductStageMapping.create({
        values: [
          { productCode: 'FA014A02', stageName: 'Assembly', candidateLines: ['3F3', '3F4', '3F5', '3F6'], isFixed: false },
          { productCode: 'FA014A02', stageName: 'Package', candidateLines: ['1F1', '1F2', '1F3'], isFixed: false },
          { productCode: 'FA015B01', stageName: 'Assembly', candidateLines: ['ESG_LINE_1', 'ESG_LINE_2'], isFixed: false },
          { productCode: 'FA015B01', stageName: 'Package', candidateLines: ['ESG_LINE_1'], isFixed: true },
        ],
      });
      console.log('✅ Created product_stage_mapping data.');
    } else {
      console.log('ℹ️ product_stage_mapping already has data.');
    }
  }

  // 3. customer_line_mapping
  const CustomerLineMapping = db.getRepository('customer_line_mapping');
  if (CustomerLineMapping) {
    const clmCount = await CustomerLineMapping.count();
    if (clmCount === 0) {
      await CustomerLineMapping.create({
        values: [
          { keyAccount: 'CUST_A', osmCategory: 'ESG', assignedLines: ['ESG_LINE_1'] },
          { keyAccount: 'CUST_B', osmCategory: 'ESG', assignedLines: ['ESG_LINE_1', 'ESG_LINE_2'] },
        ],
      });
      console.log('✅ Created customer_line_mapping data.');
    } else {
      console.log('ℹ️ customer_line_mapping already has data.');
    }
  }

  // 4. calendar_exceptions
  const CalendarExceptions = db.getRepository('calendar_exceptions');
  if (CalendarExceptions) {
    const ceCount = await CalendarExceptions.count();
    if (ceCount === 0) {
      await CalendarExceptions.create({
        values: [
          { exceptionDate: '2026-06-01', exceptionType: 'HOLIDAY', affectedLines: null, workHours: 0, setupTime: 0, remarks: 'Childrens Day' },
          { exceptionDate: '2026-06-05', exceptionType: 'MAINTENANCE', affectedLines: ['3F3'], workHours: 8, setupTime: 0, remarks: 'Monthly maintenance' },
          { exceptionDate: '2026-06-06', exceptionType: 'CHANGEOVER', affectedLines: ['1F1'], workHours: 10, setupTime: 120, remarks: 'Product switch' },
        ],
      });
      console.log('✅ Created calendar_exceptions data.');
    } else {
      console.log('ℹ️ calendar_exceptions already has data.');
    }
  }

  console.log('Seeding finished.');
}
